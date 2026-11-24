import {
  MAX_FRAME_BYTES,
  SUBAGENT_EVENTS_MAX,
  SUBAGENTS_MAX,
  type SubagentEvent,
  type SubagentInfo,
} from '@pocket-agent/protocol';
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { truncate } from '../../sessions/registry.js';
import { claudeConfigDir } from './install.js';
import { summarizeToolInput, summarizeToolOutput } from './summarize.js';

/**
 * A session's sub-agents, read from what Claude Code keeps on this PC: for each one
 * `<projects>/<project>/<session id>/subagents/agent-<id>.jsonl` (its transcript) and
 * `agent-<id>.meta.json` (the tool call that started it, its type, description, model…).
 *
 * The transcript is turned into the same events a session reports (`agent.output`,
 * `agent.tool.*`), with the same rules: text is truncated, and of tool results only command
 * output travels.
 */

/** The Agent / Task tool starts a sub-agent. */
const SPAWN_TOOLS = new Set(['Agent', 'Task']);
/** Room left in one frame for the transcript (the agent list and envelope take the rest). */
const EVENTS_BUDGET = Math.floor(MAX_FRAME_BYTES * 0.6);
const PROMPT_MAX = 6000;
const TEXT_MAX = 2000;

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** The folder holding a session's sub-agents, or null when this PC has none for it. */
async function subagentsDir(sessionId: string, configDir: string): Promise<string | null> {
  if (!/^[\w-]{1,200}$/.test(sessionId)) return null;
  const root = path.join(configDir, 'projects');
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name, sessionId, 'subagents');
    if ((await readdir(dir).catch(() => null)) !== null) return dir;
  }
  return null;
}

/** Each transcript line as JSON (unreadable lines are skipped). */
async function* lines(file: string): AsyncGenerator<Json> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    try {
      const v: unknown = JSON.parse(line);
      if (isObj(v)) yield v;
    } catch {
      /* a partial line (still being written): skip */
    }
  }
}

const blocks = (entry: Json): Json[] => {
  const content = isObj(entry['message']) ? entry['message']['content'] : undefined;
  return Array.isArray(content) ? content.filter(isObj) : [];
};

/** A tool result's content as text (a string, or text blocks). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObj)
    .map((b) => str(b['text']))
    .filter(Boolean)
    .join('\n');
}

interface Scan {
  info: Omit<SubagentInfo, 'parentToolUseId' | 'depth'> & { depth: number };
  /** The Agent tool calls this sub-agent made (the sub-agents it started). */
  spawned: string[];
}

/** One sub-agent's description and a quick pass over its transcript (times, tool calls). */
async function scan(dir: string, agentId: string): Promise<Scan | null> {
  const meta = await readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8')
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => null);
  if (!isObj(meta) || !str(meta['toolUseId'])) return null;
  let startedAt: string | null = null;
  let lastActivityAt: string | null = null;
  let toolCalls = 0;
  const spawned: string[] = [];
  // The newest tool call, until its result comes back: what the agent is doing now.
  let pending: { id: string; name: string; input: unknown } | null = null;
  for await (const entry of lines(path.join(dir, `agent-${agentId}.jsonl`))) {
    const at = str(entry['timestamp']);
    if (at) {
      startedAt ??= at;
      lastActivityAt = at;
    }
    if (entry['type'] === 'user') {
      for (const b of blocks(entry))
        if (b['type'] === 'tool_result' && pending && str(b['tool_use_id']) === pending.id) pending = null;
      continue;
    }
    if (entry['type'] !== 'assistant') continue;
    for (const b of blocks(entry)) {
      if (b['type'] !== 'tool_use') continue;
      toolCalls++;
      pending = { id: str(b['id']), name: str(b['name']), input: b['input'] };
      if (SPAWN_TOOLS.has(str(b['name'])) && str(b['id'])) spawned.push(str(b['id']));
    }
  }
  const finished = meta['finished'] === true;
  const depth = typeof meta['spawnDepth'] === 'number' ? Math.max(1, Math.min(20, meta['spawnDepth'])) : 1;
  return {
    info: {
      agentId,
      toolUseId: truncate(str(meta['toolUseId']), 200),
      type: truncate(str(meta['agentType']) || 'subagent', 100),
      description: truncate(str(meta['description']), 500),
      model: str(meta['model']) ? truncate(str(meta['model']), 100) : null,
      background: meta['requestShape'] === 'background',
      finished,
      depth,
      startedAt: startedAt && !Number.isNaN(Date.parse(startedAt)) ? new Date(startedAt).toISOString() : null,
      lastActivityAt:
        lastActivityAt && !Number.isNaN(Date.parse(lastActivityAt))
          ? new Date(lastActivityAt).toISOString()
          : null,
      toolCalls,
      current:
        pending && !finished
          ? {
              toolName: truncate(pending.name || 'Tool', 100),
              input: truncate(summarizeToolInput(pending.name, pending.input), 2000),
            }
          : null,
    },
    spawned,
  };
}

/** Every sub-agent of the session, each linked to the sub-agent that started it (if any). */
export async function listSubagents(sessionId: string, configDir = claudeConfigDir()) {
  const dir = await subagentsDir(sessionId, configDir);
  if (!dir) return null;
  const ids = (await readdir(dir))
    .map((f) => /^agent-([\w-]{1,100})\.meta\.json$/.exec(f)?.[1])
    .filter((id): id is string => !!id);
  const scans = (await Promise.all(ids.map((id) => scan(dir, id)))).filter((s): s is Scan => !!s);
  // Who started whom: a sub-agent's tool call shows up in its parent's transcript.
  const parentOf = new Map<string, string>();
  for (const s of scans) for (const child of s.spawned) parentOf.set(child, s.info.toolUseId);
  const agents: SubagentInfo[] = scans
    .map((s) => ({ ...s.info, parentToolUseId: parentOf.get(s.info.toolUseId) ?? null }))
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
    .slice(-SUBAGENTS_MAX);
  return { dir, agents };
}

/**
 * One sub-agent's transcript as session events: its prompt and replies (`agent.output`), and its
 * tool calls (`agent.tool.started`, then `.completed` or `.failed`). Long ones keep the prompt and
 * the newest lines that fit in one answer.
 */
export async function readTranscript(
  dir: string,
  agentId: string,
): Promise<{ events: SubagentEvent[]; truncated: boolean }> {
  const events: SubagentEvent[] = [];
  const tools = new Map<string, { name: string; input: string }>();
  let n = 0;
  const push = (eventType: string, payload: Json, at: string) =>
    events.push({
      id: `${agentId}-${n++}`,
      eventType,
      payload,
      createdAt: !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date(0).toISOString(),
    });

  for await (const entry of lines(path.join(dir, `agent-${agentId}.jsonl`))) {
    const at = str(entry['timestamp']);
    const type = entry['type'];
    if (type === 'user') {
      if (entry['isMeta'] === true) continue; // reminders Claude Code adds, not the prompt
      const content = isObj(entry['message']) ? entry['message']['content'] : undefined;
      if (typeof content === 'string') {
        const first = !events.length;
        push('agent.output', { role: 'user', text: truncate(content, first ? PROMPT_MAX : TEXT_MAX) }, at);
        continue;
      }
      for (const b of blocks(entry)) {
        if (b['type'] === 'text' && str(b['text'])) {
          push(
            'agent.output',
            { role: 'user', text: truncate(str(b['text']), events.length ? TEXT_MAX : PROMPT_MAX) },
            at,
          );
        } else if (b['type'] === 'tool_result') {
          const id = str(b['tool_use_id']);
          const tool = tools.get(id);
          if (!tool) continue;
          const output = resultText(b['content']);
          if (b['is_error'] === true)
            push(
              'agent.tool.failed',
              {
                toolUseId: id,
                toolName: tool.name,
                input: tool.input,
                error: truncate(output || 'Tool failed', TEXT_MAX),
              },
              at,
            );
          else
            push(
              'agent.tool.completed',
              {
                toolUseId: id,
                toolName: tool.name,
                input: tool.input,
                output: summarizeToolOutput(tool.name, output),
              },
              at,
            );
        }
      }
    } else if (type === 'assistant') {
      for (const b of blocks(entry)) {
        if (b['type'] === 'text' && str(b['text']).trim()) {
          push('agent.output', { role: 'assistant', text: truncate(str(b['text']), TEXT_MAX) }, at);
        } else if (b['type'] === 'tool_use' && str(b['id'])) {
          const name = str(b['name']);
          const input = summarizeToolInput(name, b['input']);
          tools.set(str(b['id']), { name, input });
          push('agent.tool.started', { toolUseId: str(b['id']), toolName: name, input }, at);
        }
      }
    }
  }
  return fit(events);
}

/** Keeps the prompt and as many of the newest events as fit in one answer. */
function fit(events: SubagentEvent[]): { events: SubagentEvent[]; truncated: boolean } {
  const [prompt, ...rest] = events;
  if (!prompt) return { events, truncated: false };
  let budget = EVENTS_BUDGET - JSON.stringify(prompt).length;
  const kept: SubagentEvent[] = [];
  for (let i = rest.length - 1; i >= 0 && kept.length < SUBAGENT_EVENTS_MAX - 1; i--) {
    budget -= JSON.stringify(rest[i]).length;
    if (budget < 0) break;
    kept.push(rest[i]!);
  }
  kept.reverse();
  return { events: [prompt, ...kept], truncated: kept.length < rest.length };
}

/** The answer to `agents.read`: the session's agent map and the asked-for agent's transcript. */
export async function readSubagents(
  sessionId: string,
  toolUseId: string,
  configDir = claudeConfigDir(),
): Promise<{ agents: SubagentInfo[]; events: SubagentEvent[]; truncated: boolean } | { error: string }> {
  const found = await listSubagents(sessionId, configDir);
  if (!found) return { error: 'conversation_not_found' };
  const agent = found.agents.find((a) => a.toolUseId === toolUseId);
  if (!agent) return { error: 'agent_not_found' };
  return { agents: found.agents, ...(await readTranscript(found.dir, agent.agentId)) };
}
