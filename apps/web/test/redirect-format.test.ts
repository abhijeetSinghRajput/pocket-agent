import { describe, expect, it } from 'vitest';
import { mmss, timeAgo } from '@/lib/format';
import { safeNextPath } from '@/lib/redirect';

describe('safeNextPath (open-redirect guard)', () => {
  it('allows same-site relative paths', () => {
    expect(safeNextPath('/devices')).toBe('/devices');
    expect(safeNextPath('/agents/abc?tab=log')).toBe('/agents/abc?tab=log');
  });
  it('rejects anything that could leave the site or loop back to auth pages', () => {
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      String.raw`/\evil.example`,
      'javascript:alert(1)',
      '/login',
      '/register?x',
    ]) {
      expect(safeNextPath(bad)).toBe('/chat');
    }
  });
});

describe('formatting', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  it('timeAgo', () => {
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-11-17T11:59:58Z', now)).toBe('just now');
    expect(timeAgo('2026-11-17T11:59:30Z', now)).toBe('30 seconds ago');
    expect(timeAgo('2026-11-17T11:57:00Z', now)).toBe('3 minutes ago');
    expect(timeAgo('2026-11-15T12:00:00Z', now)).toBe('2 days ago');
  });
  it('mmss', () => {
    expect(mmss(600_000)).toBe('10:00');
    expect(mmss(61_001)).toBe('1:02');
    expect(mmss(-5)).toBe('0:00');
  });
});
