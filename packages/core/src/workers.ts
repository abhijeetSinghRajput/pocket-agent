import type { AgentEventDto, WorkerKind, WorkerStatus } from '@pocket-agent/protocol';
import { toolTarget } from './chat.js';

/**
 * The workers Claude started in one session — sub-agents (the Agent/Task tool) and workflows — and
 * how each is doing, read from the session's events:
 *
 * - the tool call starting is the worker starting;
 * - a foreground one is done when its tool call is;
 * - a background one only *launches* with its tool call (workflows always run in the background);
 *   it reports later through a `<task-notification>` that Claude Code adds to the conversation,
 *   naming the tool call (`<tool-use-id>`) and how it ended (`<status>`);
 * - whatever still runs when the session ends has stopped with it.
 */
export interface Worker {
  id: string;
  kind: WorkerKind;
  title: string;
  label: string | null;
  background: boolean;
  status: WorkerStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
}

/** The tools that start a worker. */
export const WORKER_TOOL_NAMES = ['Agent', 'Task', 'Workflow'] as const;
const WORKER_TOOLS = new Set<string>(WORKER_TOOL_NAMES);

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function parseInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(str(raw));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The task notifications in a prompt: which tool call each is about and how it ended. */
export function parseTaskNotifications(
  text: string,
): { toolUseId: string; status: string; summary: string | null }[] {
  const out: { toolUseId: string; status: string; summary: string | null }[] = [];
  for (const block of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const body = block[1] ?? '';
    const field = (name: string) =>
      new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim() ?? '';
    const toolUseId = field('tool-use-id');
    if (toolUseId)
      out.push({ toolUseId, status: field('status').toLowerCase(), summary: field('summary') || null });
  }
  return out;
}

const ENDED: Record<string, WorkerStatus> = {
  completed: 'done',
  done: 'done',
  success: 'done',
  failed: 'failed',
  error: 'failed',
  killed: 'stopped',
  stopped: 'stopped',
  cancelled: 'stopped',
};

export function buildWorkers(events: AgentEventDto[]): Worker[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const workers = new Map<string, Worker>();

  for (const e of sorted) {
    const p = e.payload;
    switch (e.eventType) {
      case 'agent.tool.started': {
        const toolName = str(p['toolName']);
        const id = str(p['toolUseId']);
        if (!WORKER_TOOLS.has(toolName) || !id || workers.has(id)) break;
        const input = parseInput(p['input']);
        const workflow = toolName === 'Workflow';
        const type = str(input['subagent_type']);
        workers.set(id, {
          id,
          kind: workflow ? 'workflow' : 'subagent',
          title:
            str(input['description']) ||
            (workflow ? str(input['name']) || 'Workflow' : `${type || 'Sub-agent'} task`),
          label: (workflow ? str(input['name']) : type) || null,
          background: workflow || input['run_in_background'] === true || type === 'fork',
          status: 'running',
          startedAt: e.createdAt,
          finishedAt: null,
          summary: null,
        });
        break;
      }
      case 'agent.tool.completed':
      case 'agent.tool.failed': {
        const w = workers.get(str(p['toolUseId']));
        if (!w || w.status !== 'running') break;
        // A background worker only launched; it reports back later.
        if (w.background && e.eventType === 'agent.tool.completed') break;
        w.status = e.eventType === 'agent.tool.failed' ? 'failed' : 'done';
        w.finishedAt = e.createdAt;
        break;
      }
      case 'agent.output': {
        if (p['role'] !== 'user') break;
        for (const n of parseTaskNotifications(str(p['text']))) {
          const w = workers.get(n.toolUseId);
          if (!w) continue;
          w.status = ENDED[n.status] ?? 'done';
          w.finishedAt = e.createdAt;
          w.summary = n.summary;
        }
        break;
      }
      case 'agent.worker.updated': {
        const w = workers.get(str(p['toolUseId']));
        if (!w) break;
        const status = str(p['status']) as WorkerStatus;
        if (status === 'running') {
          // It went to the background: its tool call returning doesn't end it.
          w.background = true;
          if (w.status === 'done' && !w.summary) {
            w.status = 'running';
            w.finishedAt = null;
          }
          break;
        }
        w.status = status;
        w.finishedAt = e.createdAt;
        w.summary = str(p['summary']) || w.summary;
        break;
      }
      case 'agent.session.ended':
        for (const w of workers.values()) {
          if (w.status !== 'running') continue;
          w.status = 'stopped';
          w.finishedAt = e.createdAt;
        }
        break;
    }
  }
  return [...workers.values()];
}

/**
 * What a running sub-agent is doing now, in a few words ("Bash · npm test", "Thinking…"); null
 * when it finished or its PC doesn't say (before 0.1.10).
 */
export function nowDoing(a: {
  finished: boolean;
  current?: { toolName: string; input: string } | null | undefined;
}): string | null {
  if (a.finished || a.current === undefined) return null;
  if (a.current === null) return 'Thinking…';
  const target = toolTarget(a.current.input);
  return target ? `${a.current.toolName} · ${target}` : a.current.toolName;
}
