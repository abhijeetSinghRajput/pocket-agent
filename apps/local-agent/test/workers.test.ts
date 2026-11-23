import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workerStatus } from '../src/providers/claude-code/managed.js';
import { summarizeToolInput } from '../src/providers/claude-code/summarize.js';
import { taskNotifications, TranscriptTail } from '../src/providers/claude-code/transcript.js';

const NOTE =
  '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>toolu_01ABC</tool-use-id>\n<status>completed</status>\n<summary>Agent "Review" finished</summary>\n</task-notification>';

describe('background workers on the PC', () => {
  it('reads task notifications in both forms Claude Code writes them', () => {
    const queued = JSON.stringify({
      type: 'attachment',
      attachment: { type: 'queued_command', prompt: NOTE, commandMode: 'task-notification' },
    });
    const turn = JSON.stringify({ type: 'user', message: { role: 'user', content: NOTE } });
    const expected = [{ toolUseId: 'toolu_01ABC', status: 'completed', summary: 'Agent "Review" finished' }];
    expect(taskNotifications(queued)).toEqual(expected);
    expect(taskNotifications(turn)).toEqual(expected);
    // Anything else mentioning it (a tool result quoting it, the assistant) is not a notification.
    expect(taskNotifications(JSON.stringify({ type: 'assistant', message: { content: NOTE } }))).toEqual([]);
    expect(taskNotifications('{not json <task-notification>')).toEqual([]);
  });

  it('reports each ended worker once, even when both forms are in the file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pocket-agent-workers-'));
    const file = path.join(dir, 't.jsonl');
    writeFileSync(file, '');
    const tail = new TranscriptTail();
    tail.attach('s1', file);
    appendFileSync(
      file,
      [
        JSON.stringify({ type: 'attachment', attachment: { type: 'queued_command', prompt: NOTE } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: NOTE } }),
        '',
      ].join('\n'),
    );
    expect(tail.read('s1')).toEqual([
      { kind: 'worker', toolUseId: 'toolu_01ABC', status: 'completed', summary: 'Agent "Review" finished' },
    ]);
  });

  it('sends what the Agents tab needs about a worker, and maps how it ended', () => {
    expect(
      JSON.parse(
        summarizeToolInput('Agent', {
          description: 'Review',
          subagent_type: 'Explore',
          run_in_background: true,
          prompt: 'secret',
        }),
      ),
    ).toEqual({ description: 'Review', subagent_type: 'Explore', run_in_background: true });
    expect(
      JSON.parse(
        summarizeToolInput('Workflow', { name: 'review-changes', description: 'Review', script: 'x' }),
      ),
    ).toEqual({
      name: 'review-changes',
      description: 'Review',
    });
    expect(workerStatus('completed')).toBe('done');
    expect(workerStatus('failed')).toBe('failed');
    expect(workerStatus('killed')).toBe('stopped');
  });
});

describe('Claude plan name', () => {
  it('reads the plan and its tier the way Claude shows them', async () => {
    const { planName } = await import('../src/providers/claude-code/usage.js');
    expect(planName('max', 'default_claude_max_5x')).toBe('Max 5x');
    expect(planName('pro', 'default_claude_ai')).toBe('Pro');
    expect(planName(undefined, 'x')).toBeNull();
  });
});
