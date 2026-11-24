import { nowDoing, spanText } from '@pocket-agent/core';
import { describe, expect, it } from 'vitest';

describe('nowDoing', () => {
  it('names the tool call a running sub-agent waits on', () => {
    const current = { toolName: 'Bash', input: JSON.stringify({ command: 'npm test' }) };
    expect(nowDoing({ finished: false, current })).toBe('Bash · npm test');
  });
  it('thinking between steps, nothing once finished or from an older PC', () => {
    expect(nowDoing({ finished: false, current: null })).toBe('Thinking…');
    expect(nowDoing({ finished: true, current: null })).toBeNull();
    expect(nowDoing({ finished: false })).toBeNull();
  });
});

describe('spanText', () => {
  it('short lengths of time', () => {
    expect(spanText(14_000)).toBe('14s');
    expect(spanText(134_000)).toBe('2m 14s');
    expect(spanText(3_780_000)).toBe('1h 3m');
  });
});
