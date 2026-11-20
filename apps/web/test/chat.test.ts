import type { AgentEventDto, CommandDto } from '@pocket-agent/protocol';
import { describe, expect, it } from 'vitest';
import { buildChat } from '@/lib/chat';
import { chatListTime, dayLabel, daysAgo } from '@/lib/format';
import { openChatId } from '@/lib/nav';

let n = 0;
const at = (sec: number) => new Date(Date.UTC(2026, 10, 20, 10, 0, sec)).toISOString();
function ev(sec: number, eventType: string, payload: Record<string, unknown>): AgentEventDto {
  return { id: `e${++n}`, sessionId: 's1', eventType, payload, createdAt: at(sec) };
}
function cmd(sec: number, over: Partial<CommandDto>): CommandDto {
  return {
    id: `c${++n}`,
    deviceId: 'd1',
    sessionId: 's1',
    commandType: 'instruction',
    text: null,
    projectPath: null,
    status: 'Accepted',
    error: null,
    createdAt: at(sec),
    deliveredAt: null,
    completedAt: null,
    expiresAt: at(sec + 900),
    ...over,
  };
}
const bash = JSON.stringify({ command: 'pnpm test' });

describe('buildChat', () => {
  it('orders the conversation oldest first, whatever order the feed comes in', () => {
    const items = buildChat([
      ev(3, 'agent.output', { role: 'assistant', text: 'Done.' }),
      ev(1, 'agent.output', { role: 'user', text: 'Run the tests' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant']);
  });

  it('merges a tool call into one row with its final state and output', () => {
    const items = buildChat([
      ev(1, 'agent.tool.started', { toolUseId: 't1', toolName: 'Bash', input: bash }),
      ev(2, 'agent.tool.completed', { toolUseId: 't1', toolName: 'Bash', input: bash, output: 'ok' }),
      ev(3, 'agent.tool.started', { toolUseId: 't2', toolName: 'Read', input: '{}' }),
      ev(4, 'agent.tool.failed', { toolUseId: 't2', toolName: 'Read', input: '{}', error: 'ENOENT' }),
    ]);
    expect(items).toMatchObject([
      { kind: 'tool', toolName: 'Bash', target: 'pnpm test', state: 'done', output: 'ok' },
      { kind: 'tool', toolName: 'Read', state: 'failed', output: 'ENOENT' },
    ]);
  });

  it('pairs a permission request with its outcome', () => {
    const items = buildChat([
      ev(1, 'agent.permission.requested', { requestId: 'r1', toolName: 'Bash', input: bash, toolUseId: 't' }),
      ev(2, 'agent.permission.resolved', { requestId: 'r1', outcome: 'local' }),
    ]);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'permission', target: 'pnpm test', outcome: 'Answered on the PC' }),
    ]);
  });

  it('shows an instruction once: on its own while queued, then as its echo once Claude has it', () => {
    const c = cmd(5, { text: 'Also update the changelog' });
    const queued = buildChat([ev(1, 'agent.output', { role: 'user', text: 'Fix the bug' })], [c]);
    expect(queued).toMatchObject([
      { kind: 'user', text: 'Fix the bug' },
      { kind: 'user', text: 'Also update the changelog', command: { status: 'Accepted' } },
    ]);
    expect((queued[0] as { command?: unknown }).command).toBeUndefined();

    const delivered = buildChat(
      [
        ev(1, 'agent.output', { role: 'user', text: 'Fix the bug' }),
        ev(9, 'agent.output', { role: 'user', text: 'Also update the changelog' }),
      ],
      [{ ...c, status: 'Executing' }],
    );
    expect(delivered).toHaveLength(2);
    expect(delivered[1]).toMatchObject({ kind: 'user', command: { status: 'Executing' } });
  });

  it('matches an echo the PC truncated', () => {
    const long = 'x'.repeat(50);
    const items = buildChat(
      [ev(9, 'agent.output', { role: 'user', text: `${long.slice(0, 20)}…` })],
      [cmd(5, { text: long, status: 'Completed' })],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'user', command: { status: 'Completed' } });
  });

  it('never attaches a command to a message typed on the PC before it was sent', () => {
    const items = buildChat(
      [ev(1, 'agent.output', { role: 'user', text: 'same' })],
      [cmd(500, { text: 'same', status: 'Failed', error: 'device_offline' })],
    );
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'user', command: { status: 'Failed' } });
  });

  it('shows interrupts as notices and leaves out routine status changes', () => {
    const items = buildChat(
      [
        ev(1, 'agent.session.started', {}),
        ev(2, 'agent.session.updated', { status: 'Running' }),
        ev(3, 'agent.session.updated', { status: 'Failed' }),
      ],
      [cmd(4, { commandType: 'interrupt', status: 'Completed' })],
    );
    expect(items.map((i) => i.kind)).toEqual(['notice', 'notice', 'control']);
    expect(items[1]).toMatchObject({ text: 'Turn failed', tone: 'danger' });
  });

  it('shows AskUserQuestion as a question with the answer given on the PC', () => {
    const input = JSON.stringify({
      questions: [
        {
          question: 'Which?',
          header: 'Pick',
          options: [{ label: 'A', description: 'first' }, { label: 'B' }],
        },
      ],
    });
    const items = buildChat([
      ev(1, 'agent.tool.started', { toolUseId: 'q', toolName: 'AskUserQuestion', input }),
      ev(2, 'agent.tool.completed', {
        toolUseId: 'q',
        toolName: 'AskUserQuestion',
        input,
        output: JSON.stringify({ answers: { 'Which?': 'B' } }),
      }),
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'question',
        state: 'done',
        answers: { 'Which?': 'B' },
        questions: [
          {
            question: 'Which?',
            header: 'Pick',
            multiSelect: false,
            options: [
              { label: 'A', description: 'first' },
              { label: 'B', description: '' },
            ],
          },
        ],
      }),
    ]);
    // An older PC sends argument names only: still a question, just without the text.
    const old = buildChat([
      ev(1, 'agent.tool.failed', {
        toolUseId: 'q2',
        toolName: 'AskUserQuestion',
        input: JSON.stringify({ arguments: ['questions'] }),
        error: 'declined',
      }),
    ]);
    expect(old).toEqual([expect.objectContaining({ kind: 'question', state: 'failed', questions: [] })]);
  });

  it('drops empty assistant messages', () => {
    expect(buildChat([ev(1, 'agent.output', { role: 'assistant', text: '  ' })])).toEqual([]);
  });
});

describe('chat time labels', () => {
  const now = new Date(2026, 10, 20, 15, 0).getTime();
  const local = (d: number, h = 9) => new Date(2026, 10, d, h, 30).toISOString();

  it('counts calendar days, not 24-hour periods', () => {
    expect(daysAgo(local(20, 0), now)).toBe(0);
    expect(daysAgo(new Date(2026, 10, 19, 23, 59).toISOString(), now)).toBe(1);
  });
  it('labels days like a messenger', () => {
    expect(dayLabel(local(20), now)).toBe('Today');
    expect(dayLabel(local(19), now)).toBe('Yesterday');
    expect(chatListTime(local(19), now)).toBe('Yesterday');
    expect(chatListTime(local(20), now)).toMatch(/9:30/);
  });
});

describe('openChatId', () => {
  it('finds the open chat only on a session page', () => {
    expect(openChatId('/agents/abc')).toBe('abc');
    expect(openChatId('/agents')).toBeNull();
    expect(openChatId('/agents/abc/x')).toBeNull();
    expect(openChatId('/approvals')).toBeNull();
  });
});
