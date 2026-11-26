import type { AgentStatus, SessionCapabilities } from '@pocket-agent/protocol';
import { open, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { summarizeToolInput, summarizeToolOutput } from '../claude-code/summarize.js';

/**
 * Codex chats the user runs themselves (terminal `codex`, `codex exec`, the VS Code extension),
 * followed from Codex's own session files: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl`,
 * one JSON line per thing that happened. Watch only: the phone sees the status, the messages and
 * the commands, but can't approve or send anything (Codex runs those itself).
 *
 * This is an UNDOCUMENTED Codex file format: every field is optional, anything unexpected is
 * skipped, and nothing is ever written there. Chats Pocket Agent runs itself are left out.
 */

/** What a followed Codex chat can do from the phone: watch. */
export const CODEX_WATCH_ONLY: SessionCapabilities = {
  monitor: true,
  remoteApproval: false,
  instructAnytime: false,
  instructBetweenTurns: false,
  interrupt: false,
};

/** Pocket Agent's own app-server chats carry this originator. */
const OWN_ORIGINATOR = 'pocket-agent';

type Json = Record<string, unknown>;

interface Followed {
  id: string;
  file: string;
  /** Bytes read so far. */
  offset: number;
  /** An unfinished last line, waiting for the rest. */
  partial: string;
  /** Last time the file grew. */
  activeAt: number;
  /** Leaving this file alone (ours, or not a chat). */
  ignored: boolean;
  announced: boolean;
  /** Tool calls by call id (their output comes later). */
  calls: Map<string, { toolName: string; input: string }>;
}

export function codexHome(): string {
  return process.env['CODEX_HOME'] || path.join(os.homedir(), '.codex');
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);

/** The words of a message item (`content: [{ type: "Text" | "text", text }]`). */
function words(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' ? str((c as Json)['text']) : undefined) ?? '')
    .join('')
    .trim();
}

/** Shell commands inside a Codex tool call (plain shell tools, or code that runs commands). */
export function commandsOf(name: string, input: string): string[] {
  if (name === 'apply_patch') return [];
  try {
    const args = JSON.parse(input) as Json;
    const c = args['command'] ?? args['cmd'];
    if (Array.isArray(c)) return [c.filter((x) => typeof x === 'string').join(' ')];
    if (typeof c === 'string') return [c];
  } catch {
    // not JSON: code that calls tools
  }
  const out: string[] = [];
  for (const m of input.matchAll(/\b(?:cmd|command)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g)) {
    const raw = m[1]!;
    try {
      out.push(raw.startsWith('"') ? (JSON.parse(raw) as string) : raw.slice(1, -1));
    } catch {
      out.push(raw.slice(1, -1));
    }
  }
  return out;
}

/** Files a patch touches (`*** Update File: path`), paths only. */
export function patchFiles(input: string): Array<{ path: string; added: boolean }> {
  const out: Array<{ path: string; added: boolean }> = [];
  for (const m of input.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    out.push({ path: m[2]!.trim(), added: m[1] === 'Add' });
  }
  return out;
}

export class CodexWatcher {
  private timer: NodeJS.Timeout | null = null;
  private readonly files = new Map<string, Followed>();
  private scanning = false;

  constructor(
    private readonly registry: SessionRegistry,
    private readonly opts: {
      /** `<CODEX_HOME>/sessions`. */
      dir: string;
      /** Chats Pocket Agent runs itself (their files are left alone). */
      isManaged: (id: string) => boolean;
      intervalMs?: number;
      /** A file that hasn't changed for this long isn't picked up. */
      recentMs?: number;
      /** A followed chat with no news for this long has ended. */
      idleEndMs?: number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  start(): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs ?? 3000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const recent = this.opts.recentMs ?? 10 * 60_000;
      for (const file of await this.candidates()) {
        const st = await stat(file).catch(() => null);
        if (!st) continue;
        let f = this.files.get(file);
        if (!f) {
          if (this.now() - st.mtimeMs > recent) continue; // an old chat: not news
          f = {
            id: '',
            file,
            offset: 0,
            partial: '',
            activeAt: st.mtimeMs,
            ignored: false,
            announced: false,
            calls: new Map(),
          };
          this.files.set(file, f);
        }
        if (f.ignored) continue;
        if (f.id && this.opts.isManaged(f.id)) {
          // Pocket Agent took this chat over (continued it from the phone): it reports it now.
          f.ignored = true;
          continue;
        }
        if (st.size > f.offset) {
          f.activeAt = this.now();
          await this.read(f, st.size);
        } else if (st.size < f.offset) {
          f.offset = 0; // rewritten: start over
          f.partial = '';
        }
      }
      this.endQuiet();
    } finally {
      this.scanning = false;
    }
  }

  /** Rollout files of today and yesterday (local dates, like Codex's folders), and any followed. */
  private async candidates(): Promise<string[]> {
    const out = new Set<string>([...this.files.keys()]);
    const day = 24 * 60 * 60_000;
    for (const t of [this.now(), this.now() - day]) {
      const d = new Date(t);
      const dir = path.join(
        this.opts.dir,
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      );
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const n of names) if (/^rollout-.*\.jsonl$/.test(n)) out.add(path.join(dir, n));
    }
    return [...out];
  }

  private async read(f: Followed, size: number): Promise<void> {
    // A long chat found late: its last part only (the phone needs the recent conversation).
    const MAX = 512 * 1024;
    let start = f.offset;
    let skipFirst = false;
    if (f.offset === 0 && size > MAX) {
      await this.readMeta(f);
      if (f.ignored) return;
      start = size - MAX;
      skipFirst = true;
    }
    const fh = await open(f.file, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      f.offset = size;
      const text = f.partial + buf.toString('utf8');
      const lines = text.split('\n');
      f.partial = lines.pop() ?? '';
      if (skipFirst) lines.shift(); // cut in the middle
      for (const line of lines) {
        if (!line.trim()) continue;
        let j: Json;
        try {
          j = JSON.parse(line) as Json;
        } catch {
          continue;
        }
        this.line(f, j);
        if (f.ignored) return;
      }
    } finally {
      await fh.close();
    }
  }

  /** The first line (session_meta) of a file read from the middle. */
  private async readMeta(f: Followed): Promise<void> {
    const fh = await open(f.file, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const first = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? '';
      try {
        this.line(f, JSON.parse(first) as Json);
      } catch {
        f.ignored = true;
      }
    } finally {
      await fh.close();
    }
  }

  private line(f: Followed, j: Json): void {
    const p = (j['payload'] ?? {}) as Json;
    if (j['type'] === 'session_meta') return this.meta(f, p);
    if (!f.announced) return; // nothing before its start
    const id = f.id;
    if (j['type'] === 'event_msg') {
      switch (p['type']) {
        case 'task_started':
          return this.registry.setStatus(id, 'Running');
        case 'task_complete': {
          const error = str((p['error'] as Json | null | undefined)?.['message']);
          if (error) {
            this.registry.event(id, 'agent.error', { message: truncate(error) });
            return this.registry.setStatus(id, 'Failed');
          }
          return this.registry.setStatus(id, 'WaitingForInput');
        }
        case 'turn_aborted':
          this.registry.event(id, 'agent.output', { role: 'system', text: 'Turn interrupted' });
          return this.registry.setStatus(id, 'WaitingForInput');
        case 'item_completed':
          return this.item(f, (p['item'] ?? {}) as Json);
        default:
          return;
      }
    }
    if (j['type'] === 'response_item') return this.tool(f, p);
  }

  private meta(f: Followed, p: Json): void {
    const id = str(p['id']) ?? str(p['session_id']);
    const cwd = str(p['cwd']);
    if (f.announced || !id || !cwd) return;
    f.id = id;
    if (str(p['originator']) === OWN_ORIGINATOR || this.opts.isManaged(id) || this.registry.has(id)) {
      f.ignored = true;
      return;
    }
    const source = str(p['source']);
    this.registry.announce(
      {
        externalSessionId: id,
        provider: 'codex',
        mode: 'observed',
        projectPath: cwd,
        status: 'WaitingForInput' as AgentStatus,
        capabilities: CODEX_WATCH_ONLY,
        metadata: {
          entrypoint: source === 'vscode' ? 'codex-vscode' : 'cli',
          // The conversation is read from Codex's session file (not only the status).
          transcript: 'watched',
          ...(str(p['cli_version']) ? { codexVersion: str(p['cli_version'])! } : {}),
        },
      },
      'discovery',
    );
    f.announced = true;
  }

  /** A finished message: the user's own words, or Codex's reply. */
  private item(f: Followed, item: Json): void {
    const type = str(item['type'])?.toLowerCase();
    const text = words(item['content']);
    if (!text) return;
    if (type === 'usermessage') {
      this.registry.event(f.id, 'agent.output', { role: 'user', text: truncate(text) });
      this.registry.setStatus(f.id, 'Running', truncate(text.split(/\r?\n/)[0] ?? '', 200));
    } else if (type === 'agentmessage') {
      this.registry.event(f.id, 'agent.output', { role: 'assistant', text: truncate(text) });
    }
  }

  /** Commands and file changes, in the tool words the app draws (paths and commands only). */
  private tool(f: Followed, p: Json): void {
    const type = p['type'];
    if (type === 'function_call' || type === 'custom_tool_call') {
      const name = str(p['name']) ?? '';
      const input = str(p['arguments']) ?? str(p['input']) ?? '';
      const callId = str(p['call_id']) ?? str(p['id']) ?? '';
      if (name === 'apply_patch') {
        patchFiles(input)
          .slice(0, 20)
          .forEach((file, i) => {
            const toolName = file.added ? 'Write' : 'Edit';
            const summary = summarizeToolInput(toolName, { file_path: file.path });
            this.registry.event(f.id, 'agent.tool.started', {
              toolUseId: `${callId}:${i}`,
              toolName,
              input: summary,
            });
            f.calls.set(`${callId}:${i}`, { toolName, input: summary });
          });
        f.calls.set(callId, { toolName: 'patch', input: '' });
        return;
      }
      const command = commandsOf(name, input).join(' && ');
      if (!command) return;
      const summary = summarizeToolInput('Bash', { command });
      this.registry.event(f.id, 'agent.tool.started', {
        toolUseId: callId,
        toolName: 'Bash',
        input: summary,
      });
      f.calls.set(callId, { toolName: 'Bash', input: summary });
      return;
    }
    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      const callId = str(p['call_id']) ?? '';
      const call = f.calls.get(callId);
      if (!call) return;
      f.calls.delete(callId);
      if (call.toolName === 'patch') {
        for (const [key, c] of f.calls) {
          if (!key.startsWith(`${callId}:`)) continue;
          f.calls.delete(key);
          this.registry.event(f.id, 'agent.tool.completed', {
            toolUseId: key,
            toolName: c.toolName,
            input: c.input,
            output: '',
          });
        }
        return;
      }
      const out = p['output'];
      const text =
        typeof out === 'string'
          ? out
          : Array.isArray(out)
            ? out.map((o) => (o && typeof o === 'object' ? (str((o as Json)['text']) ?? '') : '')).join('\n')
            : '';
      // Code that ran the command says when it failed ("Script failed", "Script error: …").
      if (/^Script (failed|error)/m.test(text)) {
        this.registry.event(f.id, 'agent.tool.failed', {
          toolUseId: callId,
          toolName: 'Bash',
          input: call.input,
          error: truncate(text, 2000),
        });
        return;
      }
      this.registry.event(f.id, 'agent.tool.completed', {
        toolUseId: callId,
        toolName: 'Bash',
        input: call.input,
        output: summarizeToolOutput('Bash', { stdout: text }),
      });
    }
  }

  /** Chats with no news for a while have ended (Codex leaves no sign when it exits). */
  private endQuiet(): void {
    const idle = this.opts.idleEndMs ?? 30 * 60_000;
    for (const [file, f] of this.files) {
      if (this.now() - f.activeAt < idle) continue;
      this.files.delete(file);
      if (f.announced && !f.ignored && this.registry.get(f.id)?.mode === 'observed') {
        this.registry.end(f.id, 'idle');
      }
    }
  }
}
