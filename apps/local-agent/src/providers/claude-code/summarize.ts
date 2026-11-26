import { truncate } from '../../sessions/registry.js';

/**
 * Data minimisation: only allow-listed fields of tool inputs/outputs leave the PC.
 * File contents (Write/Edit bodies, Read results) are never forwarded — only paths and sizes.
 */
type Json = Record<string, unknown>;

const str = (v: unknown, max = 300): string | undefined =>
  typeof v === 'string' ? truncate(v, max) : undefined;
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const len = (v: unknown): number | undefined => (typeof v === 'string' ? v.length : undefined);
const clean = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** AskUserQuestion questions, bounded: at most 4 questions × 6 options, short strings. */
function questions(v: unknown): Json[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 4).map((q) => {
    const o = (q && typeof q === 'object' ? q : {}) as Json;
    return clean({
      question: str(o['question'], 500),
      header: str(o['header'], 40),
      multiSelect: o['multiSelect'] === true || undefined,
      options: Array.isArray(o['options'])
        ? o['options'].slice(0, 6).map((opt) => {
            const x = (opt && typeof opt === 'object' ? opt : {}) as Json;
            return clean({ label: str(x['label'], 120), description: str(x['description'], 300) });
          })
        : undefined,
    });
  });
}

export function summarizeToolInput(toolName: string, raw: unknown): string {
  const i = (raw && typeof raw === 'object' ? raw : {}) as Json;
  let out: Json;
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      out = { command: str(i['command'], 2000), description: str(i['description']) };
      break;
    case 'Read':
      out = { file_path: str(i['file_path']), offset: num(i['offset']), limit: num(i['limit']) };
      break;
    case 'Write':
      out = { file_path: str(i['file_path']), characters: len(i['content']) };
      break;
    case 'Edit':
      out = { file_path: str(i['file_path']), replace_all: i['replace_all'] === true || undefined };
      break;
    case 'MultiEdit':
      out = {
        file_path: str(i['file_path']),
        edits: Array.isArray(i['edits']) ? i['edits'].length : undefined,
      };
      break;
    case 'NotebookEdit':
      out = { notebook_path: str(i['notebook_path']), edit_mode: str(i['edit_mode'], 20) };
      break;
    case 'Glob':
      out = { pattern: str(i['pattern']), path: str(i['path']) };
      break;
    case 'Grep':
      out = {
        pattern: str(i['pattern']),
        path: str(i['path']),
        glob: str(i['glob']),
        type: str(i['type'], 30),
      };
      break;
    case 'WebFetch':
      out = { url: str(i['url'], 500) };
      break;
    case 'WebSearch':
      out = { query: str(i['query']) };
      break;
    case 'Task':
    case 'Agent':
      out = {
        description: str(i['description']),
        subagent_type: str(i['subagent_type'], 100),
        // The app's Agents tab: a background sub-agent keeps running after its tool call.
        ...(i['run_in_background'] === true ? { run_in_background: true } : {}),
      };
      break;
    case 'ImageGeneration':
      // Codex's picture: its own description of what it made.
      out = { description: str(i['description']) };
      break;
    case 'Workflow':
      out = { name: str(i['name'], 100), description: str(i['description']) };
      break;
    case 'AskUserQuestion':
      // Claude's question to the user is conversation (like its replies), so the text is forwarded.
      out = { questions: questions(i['questions']) };
      break;
    case 'TodoWrite':
      out = { todos: Array.isArray(i['todos']) ? i['todos'].length : undefined };
      break;
    default:
      // Unknown and MCP tools: argument names only, never values.
      out = { arguments: Object.keys(i).slice(0, 30) };
  }
  return truncate(JSON.stringify(clean(out)), 4000);
}

/**
 * Output shown in the timeline. Only command output (the "terminal output") and the user's own
 * answers to Claude's questions are forwarded.
 */
export function summarizeToolOutput(toolName: string, raw: unknown): string {
  if (toolName === 'AskUserQuestion') {
    const answers = raw && typeof raw === 'object' ? (raw as Json)['answers'] : undefined;
    if (!answers || typeof answers !== 'object') return '';
    const out = Object.fromEntries(
      Object.entries(answers as Json)
        .slice(0, 4)
        .map(([q, a]) => [truncate(q, 500), typeof a === 'string' ? truncate(a, 500) : ''] as const),
    );
    return truncate(JSON.stringify({ answers: out }), 4000);
  }
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    if (raw && typeof raw === 'object') {
      const r = raw as Json;
      const stdout = typeof r['stdout'] === 'string' ? r['stdout'] : '';
      const stderr = typeof r['stderr'] === 'string' ? r['stderr'] : '';
      return truncate([stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean).join('\n'), 4000);
    }
    if (typeof raw === 'string') return truncate(raw, 4000);
  }
  return '';
}

/** Stable key to match a PermissionRequest (which has no tool_use_id) to its PreToolUse. */
export function toolKey(toolName: string, input: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Json)
              .sort()
              .map((k) => [k, stable((v as Json)[k])]),
          )
        : v;
  return `${toolName}:${JSON.stringify(stable(input))}`;
}
