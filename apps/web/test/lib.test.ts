import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from '@/lib/api';
import { isActive, NAV_ITEMS } from '@/lib/nav';

describe('isActive', () => {
  it('matches the overview only on /', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/agents', '/')).toBe(false);
  });
  it('matches nested routes', () => {
    expect(isActive('/agents/abc', '/agents')).toBe(true);
    expect(isActive('/agentsx', '/agents')).toBe(false);
  });
  it('keeps the mobile bottom bar to at most 4 primary items plus More', () => {
    expect(NAV_ITEMS.filter((i) => i.primaryOnMobile).length).toBeLessThanOrEqual(4);
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
