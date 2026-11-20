import type { AgentEventDto, CommandDto } from '@pocket-agent/protocol';

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

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

function parseQuestions(input: string): AskedQuestion[] {
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
    }
  | { kind: 'control'; key: string; at: string; command: CommandDto }
  | { kind: 'notice'; key: string; at: string; text: string; tone: 'muted' | 'danger' };

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

  for (const e of sorted) {
    const p = e.payload;
    const at = e.createdAt;
    switch (e.eventType) {
      case 'agent.output': {
        const text = str(p['text']);
        if (p['role'] === 'user') {
          const item = { kind: 'user' as const, key: e.id, at, text };
          userItems.push(item);
          items.push(item);
        } else if (p['role'] === 'assistant') {
          if (text.trim()) items.push({ kind: 'assistant', key: e.id, at, text });
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
        };
        permissions.set(str(p['requestId']) || e.id, item);
        items.push(item);
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
        items.push({
          kind: 'notice',
          key: e.id,
          at,
          text: p['startSource'] === 'resume' ? 'Session resumed' : 'Session started',
          tone: 'muted',
        });
        break;
      case 'agent.session.ended':
        items.push({
          kind: 'notice',
          key: e.id,
          at,
          text: `Session ended${p['reason'] ? ` (${str(p['reason']).replaceAll('_', ' ')})` : ''}`,
          tone: 'muted',
        });
        break;
      case 'agent.session.updated':
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
    if (c.commandType === 'interrupt' || c.commandType === 'session.stop') {
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
    } else {
      extra.push({ kind: 'user', key: `cmd-${c.id}`, at: c.createdAt, text, command: c });
    }
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
  return extra.length ? [...shaped, ...extra].sort(byTime) : shaped;
}
