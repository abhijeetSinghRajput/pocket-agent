import { buildChat, chatList, chatMatches } from '@pocket-agent/core';
import type { AgentEventDto, AgentSessionDto } from '@pocket-agent/protocol';
import { describe, expect, it } from 'vitest';

const at = (min: number) => new Date(Date.UTC(2026, 10, 24, 12, min)).toISOString();
const chat = (id: string, min: number, over: Partial<AgentSessionDto> = {}) =>
  ({
    id,
    lastActivityAt: at(min),
    endedAt: null,
    pinned: false,
    archived: false,
    ...over,
  }) as AgentSessionDto;

describe('chatList', () => {
  const all = [
    chat('old-pinned', 1, { pinned: true }),
    chat('new', 9),
    chat('ended', 8, { endedAt: at(8) }),
    chat('archived', 10, { archived: true }),
  ];
  it('pinned first, then newest; archived chats only under Archived', () => {
    expect(chatList(all, 'active').map((c) => c.id)).toEqual(['old-pinned', 'new']);
    expect(chatList(all, 'all').map((c) => c.id)).toEqual(['old-pinned', 'new', 'ended']);
    expect(chatList(all, 'archived').map((c) => c.id)).toEqual(['archived']);
  });
});

describe('chatMatches', () => {
  let n = 0;
  const ev = (sec: number, eventType: string, payload: Record<string, unknown>): AgentEventDto => ({
    id: `e${++n}`,
    sessionId: 's',
    eventType,
    payload,
    createdAt: new Date(Date.UTC(2026, 10, 24, 12, 0, sec)).toISOString(),
  });
  const items = buildChat([
    ev(1, 'agent.output', { role: 'user', text: 'Fix the Upload bug' }),
    ev(2, 'agent.tool.started', {
      toolUseId: 't',
      toolName: 'Read',
      input: JSON.stringify({ file_path: 'src/upload.ts' }),
    }),
    ev(3, 'agent.output', { role: 'assistant', text: 'Done, uploads work again.' }),
    ev(4, 'agent.output', { role: 'assistant', text: 'Anything else?' }),
  ]);

  it('finds messages and tool steps by their words, oldest first, case aside', () => {
    // The request, the file it read and the reply mention it; "Anything else?" doesn't.
    expect(chatMatches(items, 'UPLOAD')).toEqual(items.slice(0, 3).map((i) => i.key));
  });
  it('needs 2 characters', () => {
    expect(chatMatches(items, 'u')).toEqual([]);
    expect(chatMatches(items, '  ')).toEqual([]);
  });
});
