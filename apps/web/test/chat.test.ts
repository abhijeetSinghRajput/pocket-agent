import type { AgentEventDto, CommandDto } from '@pocket-agent/protocol';
import { describe, expect, it } from 'vitest';
import { answerText } from '@/components/approvals/approval-card';
import { typeOver } from '@/components/agents/chat-messages';
import { resetLabel } from '@/components/claude-usage';
import { buildChat, isQueued } from '@/lib/chat';
import { chatListTime, dayLabel, daysAgo, recentSections } from '@/lib/format';
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
    attachments: [],
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

  it('shows thinking time as its own step, other system notes as notices', () => {
    const items = buildChat([
      ev(1, 'agent.output', { role: 'system', text: 'Thought for 2s' }),
      ev(2, 'agent.output', { role: 'system', text: 'Thought for 1m 24s' }),
      ev(3, 'agent.output', { role: 'system', text: 'Subagent Explore started' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['thought', 'thought', 'notice']);
  });

  it('shows Claude’s question once: as the question, not also as a permission request', () => {
    const input = JSON.stringify({
      questions: [{ question: 'Rock or Paper?', options: [{ label: 'Rock' }] }],
    });
    const items = buildChat([
      ev(1, 'agent.tool.started', { toolUseId: 'q1', toolName: 'AskUserQuestion', input }),
      ev(2, 'agent.permission.requested', {
        toolUseId: 'q1',
        requestId: 'q1',
        toolName: 'AskUserQuestion',
        input,
      }),
      ev(3, 'agent.permission.resolved', { requestId: 'q1', outcome: 'remote' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['question']);
  });

  it('shows files with the message they were sent with', () => {
    const shot = {
      id: '0190a7a0-0000-7000-8000-000000000001',
      name: 'shot.png',
      mime: 'image/png',
      size: 10,
    };
    const pasted = { ...shot, id: '0190a7a0-0000-7000-8000-000000000002', name: 'attachment-1.png' };
    const items = buildChat(
      [
        // Typed in the editor with a pasted image: the PC uploads it a moment later.
        ev(1, 'agent.output', { role: 'user', text: 'what is wrong here?' }),
        ev(3, 'agent.output', { role: 'user', text: '', attachments: [pasted] }),
        // Sent from the app with a photo.
        ev(20, 'agent.output', { role: 'user', text: 'and this one' }),
      ],
      [cmd(19, { text: 'and this one', attachments: [shot] as never })],
    );
    expect(items.map((i) => i.kind)).toEqual(['user', 'user']);
    expect(items[0]).toMatchObject({
      text: 'what is wrong here?',
      attachments: [{ name: 'attachment-1.png' }],
    });
    expect(items[1]).toMatchObject({ text: 'and this one', attachments: [{ name: 'shot.png' }] });
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

describe('answering Claude’s question', () => {
  const q = {
    question: 'Which sizes?',
    header: '',
    multiSelect: true,
    options: [
      { label: 'S', description: '' },
      { label: 'M', description: '' },
      { label: 'L', description: '' },
    ],
  };
  it('sends the chosen labels in Claude’s order, with the user’s own words last', () => {
    expect(answerText(q, { labels: ['L', 'S'], other: '' })).toBe('S, L');
    expect(answerText(q, { labels: ['M'], other: ' XXL ' })).toBe('M, XXL');
    expect(answerText(q, { labels: [], other: 'none of these' })).toBe('none of these');
  });
  it('is empty until something is picked (so it can’t be sent)', () => {
    expect(answerText(q, undefined)).toBe('');
    expect(answerText(q, { labels: [], other: '   ' })).toBe('');
  });
});

describe('Claude usage', () => {
  const now = new Date(2026, 10, 21, 10, 0);
  it('says when a limit resets, only if that is still ahead', () => {
    expect(resetLabel(new Date(2026, 10, 21, 13, 30).toISOString(), now)).toMatch(/^Resets at 1:30/);
    expect(resetLabel(new Date(2026, 10, 27, 1, 30).toISOString(), now)).toMatch(/^Resets .*27.* at 1:30/);
    expect(resetLabel(new Date(2026, 10, 21, 9, 0).toISOString(), now)).toBeNull();
    expect(resetLabel(null, now)).toBeNull();
  });
});

describe('the working verb is typed over the last one', () => {
  const frames = (from: string, to: string) =>
    Array.from({ length: Math.max(from.length, to.length) }, (_, i) => typeOver(from, to, i + 1));
  it('replaces letters from the left, then deletes what is left of a longer word', () => {
    expect(frames('Herding', 'Cook')).toEqual([
      'Cerding',
      'Cording',
      'Cooding',
      'Cooking',
      'Cookin',
      'Cooki',
      'Cook',
    ]);
  });
  it('types on past the end of a shorter word', () => {
    expect(frames('Cook', 'Forming')).toEqual(['Fook', 'Fook', 'Fork', 'Form', 'Formi', 'Formin', 'Forming']);
  });
});

describe('notification sections', () => {
  const now = new Date(2026, 10, 21, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 12) => ({ createdAt: new Date(y, m, d, h).toISOString() });
  it('groups by Today, Yesterday and Last 7 days, and keeps the rest apart', () => {
    const items = [
      at(2026, 10, 21, 9),
      at(2026, 10, 20, 23),
      at(2026, 10, 17),
      at(2026, 10, 15),
      at(2026, 10, 10),
    ];
    const { sections, earlier } = recentSections(items, now);
    expect(sections.map((s) => [s.label, s.items.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 1],
      ['Last 7 days', 2],
    ]);
    expect(earlier).toHaveLength(1);
  });
  it('leaves out empty sections', () => {
    const { sections, earlier } = recentSections([at(2026, 10, 19)], now);
    expect(sections.map((s) => s.label)).toEqual(['Last 7 days']);
    expect(earlier).toEqual([]);
  });
});

describe('queued messages', () => {
  it('wait apart from the conversation until Claude picks them up', () => {
    const items = buildChat(
      [
        ev(1, 'agent.output', { role: 'user', text: 'typed on the PC' }),
        ev(30, 'agent.output', { role: 'user', text: 'run it' }),
      ],
      [
        cmd(20, { text: 'run it', status: 'Executing' }), // picked up: it is in the conversation
        cmd(25, { text: 'and then deploy', status: 'Accepted' }), // still waiting
        cmd(26, { text: 'never ran', status: 'Expired' }), // over: stays where it was sent
      ],
    );
    expect(items.filter(isQueued).map((i) => (i.kind === 'user' ? i.text : ''))).toEqual(['and then deploy']);
  });
});
