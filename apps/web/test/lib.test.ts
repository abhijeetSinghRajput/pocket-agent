import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from '@/lib/api';
import { isActive, isChatsRoute, NAV_ITEMS } from '@/lib/nav';

describe('isActive', () => {
  it('treats the chat list and every open chat as Chats (home)', () => {
    expect(isActive('/chat', '/chat')).toBe(true);
    expect(isActive('/chat/abc', '/chat')).toBe(true);
    expect(isActive('/chat/abc', '/agents')).toBe(false); // a chat is not the Agents page
    expect(isActive('/approvals', '/chat')).toBe(false);
    expect(isChatsRoute('/settings')).toBe(false);
  });
  it('matches nested routes', () => {
    expect(isActive('/devices/abc', '/devices')).toBe(true);
    expect(isActive('/agentsx', '/agents')).toBe(false);
  });
  it('keeps the bottom bar to 3 sections plus the profile button; settings live in the profile', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Chats', 'Agents', 'Devices']);
  });
});

describe('fetchHealth', () => {
  afterEach(() => vi.unstubAllGlobals());
  const body = {
    status: 'degraded',
    service: 'pocket-agent-api',
    version: '0.1.0',
    uptimeSeconds: 1,
    checks: { database: { status: 'up', latencyMs: 1 }, redis: { status: 'down', error: 'x' } },
  };

  it('parses a degraded 503 body instead of treating it as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 503 })),
    );
    expect((await fetchHealth(undefined, 'http://api')).kind).toBe('degraded');
  });

  it('reports unreachable on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect((await fetchHealth(undefined, 'http://api')).kind).toBe('unreachable');
  });

  it('never reports a malformed body as healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
    );
    expect((await fetchHealth(undefined, 'http://api')).kind).toBe('unreachable');
  });
});
