import type { AgentEventDto, CommandDto } from '@pocket-agent/protocol';
import { isControl } from './commands.js';
import { spanText } from './format.js';
import { AttachmentRefs, type AttachmentRef } from '@pocket-agent/protocol';

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Context the editor or Claude Code adds to a prompt; the person never typed it. */
const INJECTED =
  /<(ide_opened_file|ide_selection|ide_diagnostics|system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|command-message)>[\s\S]*?<\/\1>/g;
/** Prompts that are entirely an automatic event (a background task finishing), not the person. */
const AUTOMATIC = /^\s*<(task-notification|bash-notification)>[\s\S]*<\/\1>\s*$/;

/**
 * What the person actually wrote in a prompt: injected context removed, a slash command shown as
 * typed (`/model opus`). Null when nothing of theirs is left (an automatic notification).
 */
export function cleanPrompt(text: string): string | null {
  if (AUTOMATIC.test(text)) return null;
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return [command[1]!.trim(), args].filter(Boolean).join(' ');
  }
  return text.replace(INJECTED, '').trim();
}

/** The single most useful field of a summarised tool input. */
export function toolTarget(input: unknown): string {
  try {
    const i = JSON.parse(str(input)) as P;
    return (
      str(i['command']) ||
      str(i['file_path']) ||
      str(i['pattern']) ||
      str(i['url']) ||
      str(i['query']) ||
      str(i['description']) ||
      str(i['notebook_path']) ||
      ''
    );
  } catch {
    return '';
  }
}

export const PERMISSION_OUTCOME: Record<string, string> = {
  local: 'Answered on the PC',
  remote: 'Answered in Pocket Agent',
  auto_denied: 'Denied automatically — no approval channel yet',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
};

export interface AskedQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

export function parseQuestions(input: string): AskedQuestion[] {
  try {
    const raw = (JSON.parse(input) as P)['questions'];
    if (!Array.isArray(raw)) return [];
    return raw.map((q: P) => ({
      question: str(q['question']),
      header: str(q['header']),
      multiSelect: q['multiSelect'] === true,
      options: Array.isArray(q['options'])
        ? q['options'].map((o: P) => ({ label: str(o['label']), description: str(o['description']) }))
        : [],
    }));
  } catch {
    return [];
  }
}

function parseAnswers(output: string): Record<string, string> {
  try {
    const a = (JSON.parse(output) as P)['answers'];
    return a && typeof a === 'object'
      ? Object.fromEntries(Object.entries(a as P).map(([k, v]) => [k, str(v)]))
      : {};
  } catch {
    return {};
  }
}

export type ToolState = 'running' | 'done' | 'failed';

export type ChatItem =
  | {
      kind: 'user';
      key: string;
      at: string;
      text: string;
      /** Set when the message was sent from Pocket Agent (carries its delivery status). */
      command?: CommandDto;
      /** Photos/PDFs sent with it (from the app, or attached in the editor). */
      attachments?: AttachmentRef[];
      /**
       * Sent from this app and not confirmed by the server yet ('sending'), or not sent at all
       * ('failed': it can be sent again). Absent for everything the server knows.
       */
      local?: 'sending' | 'failed';
    }
  | { kind: 'assistant'; key: string; at: string; text: string }
  | {
      kind: 'tool';
      key: string;
      at: string;
      toolName: string;
      target: string;
      state: ToolState;
      output: string;
      /** Summarised tool input as sent by the PC (JSON). */
      input: string;
    }
  | {
      kind: 'question';
      key: string;
      at: string;
      /** Empty when the PC's Local Agent is too old to send the question text. */
      questions: AskedQuestion[];
      /** Question text -> the answer given on the PC. */
      answers: Record<string, string>;
      state: ToolState;
    }
  | {
      kind: 'permission';
      key: string;
      at: string;
      toolName: string;
      target: string;
      outcome: string | null;
      /** Asked on the PC only (not held for Pocket Agent): it is answered there. */
      onPc?: boolean;
    }
  | { kind: 'control'; key: string; at: string; command: CommandDto }
  /** "Thought for 2s": how long Claude thought before its next step (never the thinking itself). */
  | { kind: 'thought'; key: string; at: string; text: string }
  | { kind: 'notice'; key: string; at: string; text: string; tone: 'muted' | 'danger' }
  /** A turn finished: what it did, at a glance (only for turns that used tools). */
  | {
      kind: 'summary';
      key: string;
      at: string;
      /** From your message (or the turn's first step) to Claude finishing. */
      durationMs: number;
      /** Files it edited or wrote, in the order first touched. */
      files: string[];
      /** Shell commands it ran. */
      commands: number;
      /** Tool steps in all, and how many of them failed. */
      steps: number;
      failed: number;
    };

/** Tools that change a file (their target is the file). */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** The PC reports thinking time as a system note with exactly this shape. */
const THOUGHT = /^Thought for (\d+m )?\d+s$/;

/**
 * A message sent from the app that Claude hasn't picked up yet. It has no place in the conversation
 * so far: it waits at the bottom until it is delivered.
 */
export function isQueued(item: ChatItem): boolean {
  if (item.kind !== 'user') return false;
  // Not confirmed yet (or not sent): it waits with the others, under everything.
  if (item.local) return true;
  return (
    !!item.command &&
    item.key.startsWith('cmd-') &&
    (item.command.status === 'Pending' ||
      item.command.status === 'Delivered' ||
      item.command.status === 'Accepted')
  );
}

const byTime = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);

/** The PC truncates long texts ("…" at the end); a command matches its echo either way. */
function sameText(eventText: string, commandText: string): boolean {
  const e = eventText.trim();
  const c = commandText.trim();
  if (e === c) return true;
  const cut = e.replace(/…$/, '');
  return cut.length > 0 && cut !== e && c.startsWith(cut);
}

/**
 * Turns a session's event feed (any order) and the commands sent to it into one conversation,
 * oldest first:
 * - a tool call's started/completed/failed events become a single row with its final state;
 * - a permission request and its resolution become a single row;
 * - an instruction sent from Pocket Agent is shown once: as its echo in the session when Claude
 *   received it, or on its own (with its delivery status) while it is still on the way or failed;
 * - status changes are left out (the header and the "working…" indicator show the live status).
 */
export function buildChat(events: AgentEventDto[], commands: CommandDto[] = []): ChatItem[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();
  const permissions = new Map<string, Extract<ChatItem, { kind: 'permission' }>>();
  const userItems: Extract<ChatItem, { kind: 'user' }>[] = [];
  let started = false;
  let ended = false;
  // The turn in progress: when it began and its tool steps (finished turns get a summary).
  type Tool = Extract<ChatItem, { kind: 'tool' }>;
  let turnStart: string | null = null;
  let turnTools: Tool[] = [];
  const turns: { key: string; at: string; startedAt: string; tools: Tool[] }[] = [];

  for (const e of sorted) {
    const p = e.payload;
    const at = e.createdAt;
    switch (e.eventType) {
      case 'agent.output': {
        if (p['role'] === 'user') {
          const files = AttachmentRefs.safeParse(p['attachments']);
          const attachments = files.success && files.data.length ? files.data : undefined;
          const cleaned = cleanPrompt(str(p['text']));
          // Only editor context or an automatic notice: nothing the person said.
          if (cleaned === null || (!cleaned && !attachments)) break;
          const text = cleaned;
          // The PC uploads files attached in the editor a moment after the prompt: they belong to it.
          const previous = userItems.at(-1);
          if (!text && attachments && previous && Date.parse(at) - Date.parse(previous.at) < 10 * 60_000) {
            previous.attachments = [...(previous.attachments ?? []), ...attachments];
            break;
          }
          const item: Extract<ChatItem, { kind: 'user' }> = {
            kind: 'user',
            key: e.id,
            at,
            text,
            ...(attachments ? { attachments } : {}),
          };
          userItems.push(item);
          items.push(item);
          turnStart ??= at;
          break;
        }
        const text = str(p['text']);
        if (p['role'] === 'assistant') {
          if (text.trim()) items.push({ kind: 'assistant', key: e.id, at, text });
        } else if (THOUGHT.test(text)) {
          items.push({ kind: 'thought', key: e.id, at, text });
        } else if (text) {
          items.push({ kind: 'notice', key: e.id, at, text, tone: 'muted' });
        }
        break;
      }
      case 'agent.tool.started':
      case 'agent.tool.completed':
      case 'agent.tool.failed': {
        const id = str(p['toolUseId']) || e.id;
        const state: ToolState =
          e.eventType === 'agent.tool.started'
            ? 'running'
            : e.eventType === 'agent.tool.completed'
              ? 'done'
              : 'failed';
        const output = str(p['output']) || str(p['error']);
        const existing = tools.get(id);
        if (existing) {
          if (state !== 'running') {
            existing.state = state;
            existing.output = output;
          }
          existing.target ||= toolTarget(p['input']);
          existing.input ||= str(p['input']);
        } else {
          const item = {
            kind: 'tool' as const,
            key: e.id,
            at,
            toolName: str(p['toolName']) || 'Tool',
            target: toolTarget(p['input']),
            state,
            output,
            input: str(p['input']),
          };
          tools.set(id, item);
          items.push(item);
          turnStart ??= at;
          turnTools.push(item);
        }
        break;
      }
      case 'agent.permission.requested': {
        const item = {
          kind: 'permission' as const,
          key: e.id,
          at,
          toolName: str(p['toolName']) || 'a tool',
          target: toolTarget(p['input']),
          outcome: null as string | null,
          onPc: p['awaitingRemote'] !== true,
        };
        permissions.set(str(p['requestId']) || e.id, item);
        // Claude's question is shown as the question itself (and answered there), not as a permission.
        if (item.toolName !== 'AskUserQuestion') items.push(item);
        break;
      }
      case 'agent.permission.resolved': {
        const label = PERMISSION_OUTCOME[str(p['outcome'])] ?? 'Permission resolved';
        const req = permissions.get(str(p['requestId']));
        if (req) req.outcome = label;
        else items.push({ kind: 'notice', key: e.id, at, text: label, tone: 'muted' });
        break;
      }
      case 'agent.session.started':
        // Each message sent from the phone to an editor session runs as its own Claude process on
        // the PC, and each reports a start. The conversation goes on: mark only its beginning, and
        // a real comeback after it ended.
        if (started && !ended) break;
        items.push({
          kind: 'notice',
          key: e.id,
          at,
          text: started || p['startSource'] === 'resume' ? 'Session resumed' : 'Session started',
          tone: 'muted',
        });
        started = true;
        ended = false;
        break;
      case 'agent.session.ended':
        ended = true;
        items.push({
          kind: 'notice',
          key: e.id,
          at,
          text: `Session ended${p['reason'] ? ` (${str(p['reason']).replaceAll('_', ' ')})` : ''}`,
          tone: 'muted',
        });
        break;
      case 'agent.session.updated':
        // Claude finished and waits for you: the turn is over.
        if (p['status'] === 'WaitingForInput' && turnStart) {
          if (turnTools.length)
            turns.push({ key: `sum-${e.id}`, at, startedAt: turnStart, tools: turnTools });
          turnStart = null;
          turnTools = [];
        }
        if (p['status'] === 'Failed')
          items.push({ kind: 'notice', key: e.id, at, text: 'Turn failed', tone: 'danger' });
        break;
      case 'agent.error':
        items.push({ kind: 'notice', key: e.id, at, text: str(p['message']) || 'Error', tone: 'danger' });
        break;
    }
  }

  // Attach each instruction to its echo in the session; the rest are shown where they were sent.
  const claimed = new Set<object>();
  const extra: ChatItem[] = [];
  for (const c of [...commands].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (isControl(c)) {
      extra.push({ kind: 'control', key: `cmd-${c.id}`, at: c.createdAt, command: c });
      continue;
    }
    const text = c.text ?? '';
    const echo = userItems.find(
      (u) =>
        !claimed.has(u) &&
        !u.command &&
        Date.parse(u.at) >= Date.parse(c.createdAt) - 60_000 &&
        sameText(u.text, text),
    );
    if (echo) {
      claimed.add(echo);
      echo.command = c;
      if (c.attachments.length) echo.attachments = c.attachments;
    } else {
      extra.push({
        kind: 'user',
        key: `cmd-${c.id}`,
        at: c.createdAt,
        text,
        command: c,
        ...(c.attachments.length ? { attachments: c.attachments } : {}),
      });
    }
  }

  // Each finished turn's summary, made now that its steps' final states are known.
  for (const t of turns) {
    const files = [
      ...new Set(
        t.tools.filter((x) => EDIT_TOOLS.has(x.toolName) && x.state === 'done').map((x) => x.target),
      ),
    ].filter(Boolean);
    items.push({
      kind: 'summary',
      key: t.key,
      at: t.at,
      durationMs: Math.max(0, Date.parse(t.at) - Date.parse(t.startedAt)),
      files,
      commands: t.tools.filter((x) => x.toolName === 'Bash' || x.toolName === 'PowerShell').length,
      steps: t.tools.length,
      failed: t.tools.filter((x) => x.state === 'failed').length,
    });
  }

  // Claude's questions to the user read as questions, not as tool calls.
  const shaped = items.map((i): ChatItem =>
    i.kind === 'tool' && i.toolName === 'AskUserQuestion'
      ? {
          kind: 'question',
          key: i.key,
          at: i.at,
          questions: parseQuestions(i.input),
          answers: i.state === 'done' ? parseAnswers(i.output) : {},
          state: i.state,
        }
      : i,
  );
  return extra.length || turns.length ? [...shaped, ...extra].sort(byTime) : shaped;
}

/** Tools whose step shows an IN/OUT block (the command, then its output). */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'BashOutput']);

/** A tool step's state, as read out to screen readers. */
export const TOOL_STATE: Record<Extract<ChatItem, { kind: 'tool' }>['state'], string> = {
  running: 'running',
  done: 'finished',
  failed: 'failed',
};

/**
 * What an answer to Claude's question picked: the options (an answer joins their labels with
 * ", ", and a label may itself contain a comma, so whole labels are matched, longest first) and
 * the user's own words, if any were added.
 */
export function readAnswer(
  q: Pick<AskedQuestion, 'options'>,
  answer: string | undefined,
): { chosen: Set<string>; own: string | null } {
  const chosen = new Set<string>();
  if (!answer) return { chosen, own: null };
  let rest = `, ${answer.trim()}, `;
  for (const o of [...q.options].sort((a, b) => b.label.length - a.label.length)) {
    const piece = `, ${o.label}, `;
    if (o.label && rest.includes(piece)) {
      chosen.add(o.label);
      rest = rest.replace(piece, ', ');
    }
  }
  const own = rest.replace(/^[,\s]+|[,\s]+$/g, '');
  return { chosen, own: own || null };
}

/**
 * One-tap replies offered when Claude has finished and waits for you (the phone shows them above
 * an empty message box). Each is sent as it reads.
 */
export const QUICK_REPLIES = [
  'Continue',
  'Run the tests',
  'Commit this',
  'Explain what you changed',
] as const;

/** A finished turn in a few words: "2m 14s · 3 files changed · 5 commands · 1 failed". */
export function summaryParts(s: Extract<ChatItem, { kind: 'summary' }>): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    spanText(s.durationMs),
    ...(s.files.length ? [plural(s.files.length, 'file changed', 'files changed')] : []),
    ...(s.commands ? [plural(s.commands, 'command', 'commands')] : []),
    ...(!s.files.length && !s.commands ? [plural(s.steps, 'step', 'steps')] : []),
    ...(s.failed ? [`${s.failed} failed`] : []),
  ];
}

/** What a chat item says, for searching inside the chat (the words shown for it). */
function searchableText(i: ChatItem): string {
  switch (i.kind) {
    case 'user':
    case 'assistant':
    case 'thought':
    case 'notice':
      return i.text;
    case 'tool':
      return `${i.toolName} ${i.target} ${i.output}`;
    case 'permission':
      return `${i.toolName} ${i.target}`;
    case 'question':
      return [
        ...i.questions.flatMap((q) => [q.question, ...q.options.map((o) => o.label)]),
        ...Object.values(i.answers),
      ].join(' ');
    case 'summary':
      return i.files.join(' ');
    case 'control':
      return '';
  }
}

/**
 * Search inside a chat: the keys of the items whose words contain the query (case aside), oldest
 * first. Fewer than 2 characters finds nothing.
 */
export function chatMatches(items: readonly ChatItem[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return items.filter((i) => searchableText(i).toLowerCase().includes(q)).map((i) => i.key);
}
