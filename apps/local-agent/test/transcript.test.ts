import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeHookHandler } from '../src/providers/claude-code/hooks.js';
import {
  thoughtLabel,
  TranscriptTail,
  type TranscriptEntry,
} from '../src/providers/claude-code/transcript.js';
import { SessionRegistry, type SessionEventOut } from '../src/sessions/registry.js';

// Lines as Claude Code 2.1 writes them: one content block per line.
let n = 0;
const line = (o: Record<string, unknown>) => JSON.stringify({ uuid: `u${++n}`, ...o }) + '\n';
const text = (t: string, extra: Record<string, unknown> = {}) =>
  line({
    type: 'assistant',
    isSidechain: false,
    message: { content: [{ type: 'text', text: t }] },
    ...extra,
  });
const toolUse = () =>
  line({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
  });
const thinking = () =>
  line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } });
const toolResult = () =>
  line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'secret' }] } });

const thought = (ms: number, messageId: string) =>
  line({
    type: 'assistant',
    thinkingDurationMs: ms,
    message: { id: messageId, content: [{ type: 'thinking', thinking: 'private reasoning' }] },
  });
const texts = (entries: TranscriptEntry[]) => entries.map((e) => ('text' in e ? e.text : '[files]'));

function file(initial = '') {
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'pa-transcript-')), 's.jsonl');
  writeFileSync(p, initial);
  return p;
}

describe('TranscriptTail', () => {
  it('reports only Claude’s new text blocks, in order, from where it attached', () => {
    const p = file(text('old history'));
    const t = new TranscriptTail();
    t.attach('s', p);
    appendFileSync(p, thinking() + text('Checking the build first.') + toolUse() + toolResult());
    expect(texts(t.read('s'))).toEqual(['Checking the build first.']);
    appendFileSync(p, text('Sub-agent says hi', { isSidechain: true }) + text('All green.'));
    expect(texts(t.read('s'))).toEqual(['All green.']);
    expect(texts(t.read('s'))).toEqual([]);
  });

  it('reports how long Claude thought (once per reply), never the thinking itself', () => {
    const p = file();
    const t = new TranscriptTail();
    t.attach('s', p);
    // Claude Code writes a reply's thinking over several lines; the first carries the time.
    appendFileSync(p, thought(2045, 'msg_1') + thought(6, 'msg_1') + text('On it.') + thought(695, 'msg_2'));
    const out = t.read('s');
    expect(out).toEqual([
      { kind: 'thought', text: 'Thought for 2s' },
      { kind: 'text', text: 'On it.' },
      { kind: 'thought', text: 'Thought for 1s' },
    ]);
    expect(JSON.stringify(out)).not.toContain('private reasoning');
    expect(thoughtLabel(84_000)).toBe('Thought for 1m 24s');
  });

  it('waits for a line to be complete', () => {
    const p = file();
    const t = new TranscriptTail();
    t.attach('s', p);
    const l = text('Half written');
    appendFileSync(p, l.slice(0, 20));
    expect(texts(t.read('s'))).toEqual([]);
    appendFileSync(p, l.slice(20));
    expect(texts(t.read('s'))).toEqual(['Half written']);
  });

  it('never reports the same text twice between the transcript and Stop', () => {
    const p = file();
    const t = new TranscriptTail();
    t.attach('s', p);
    appendFileSync(p, text('Done.'));
    expect(texts(t.read('s'))).toEqual(['Done.']);
    expect(t.claim('s', 'Done.')).toBe(false); // Stop's last_assistant_message: already shown
    expect(t.claim('s', 'Another')).toBe(true); // not in the transcript yet: Stop reports it…
    appendFileSync(p, text('Another'));
    expect(texts(t.read('s'))).toEqual([]); // …and the transcript line isn't repeated
  });

  it('skips a turn Pocket Agent already reported itself', () => {
    const p = file();
    const t = new TranscriptTail();
    t.attach('s', p);
    appendFileSync(p, text('From the woken turn'));
    t.skipToEnd('s');
    appendFileSync(p, text('Back in the editor'));
    expect(texts(t.read('s'))).toEqual(['Back in the editor']);
  });
});

describe('hooks report what Claude says between tool calls', () => {
  it('in the same order as the editor', () => {
    const events: SessionEventOut[] = [];
    const registry = new SessionRegistry((e) => events.push(e));
    const h = new ClaudeHookHandler(registry);
    const p = file();
    const base = { session_id: 's1', cwd: 'C:\\app', transcript_path: p };
    h.handle({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
    h.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'fix it' });
    appendFileSync(p, text('Format check fails; excluding the folder.') + toolUse());
    h.handle({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: {},
    });
    appendFileSync(p, toolResult() + text('Fixed.'));
    h.handle({ ...base, hook_event_name: 'Stop', last_assistant_message: 'Fixed.' });

    const timeline = events
      .filter((e) => e.eventType === 'agent.output' || e.eventType === 'agent.tool.started')
      .map((e) =>
        e.eventType === 'agent.output'
          ? `${(e.payload as { role: string }).role}: ${(e.payload as { text: string }).text}`
          : 'tool',
      );
    expect(timeline).toEqual([
      'user: fix it',
      'assistant: Format check fails; excluding the folder.',
      'tool',
      'assistant: Fixed.',
    ]);
  });
});
