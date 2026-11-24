import { describe, expect, it } from 'vitest';
import { attachmentLimit, ConfigureSessionRequest, versionBelow } from '../src/index.js';

describe('versionBelow', () => {
  it('compares x.y.z numerically, ignoring a pre-release tag', () => {
    expect(versionBelow('0.1.7', '0.1.8')).toBe(true);
    expect(versionBelow('0.1.8', '0.1.8')).toBe(false);
    expect(versionBelow('0.1.10', '0.1.9')).toBe(false); // not a string comparison
    expect(versionBelow('0.2.0-beta.1', '0.1.9')).toBe(false);
    expect(versionBelow('1', '0.9.9')).toBe(false);
    expect(versionBelow('0', '0.1.4')).toBe(true);
    expect(versionBelow('unknown', '0.1.4')).toBe(true);
  });

  it('sets how many files a PC takes', () => {
    expect(attachmentLimit(undefined)).toBe(4);
    expect(attachmentLimit('0.1.4')).toBe(4);
    expect(attachmentLimit('0.1.5')).toBe(20);
  });
});

describe('ConfigureSessionRequest', () => {
  const key = '0190a6f2-7c1b-7cc0-9d4b-6a5d3c2b1a00';
  it('needs a mode or a model', () => {
    expect(ConfigureSessionRequest.safeParse({ idempotencyKey: key }).success).toBe(false);
    expect(ConfigureSessionRequest.safeParse({ idempotencyKey: key, permissionMode: 'auto' }).success).toBe(
      true,
    );
    expect(
      ConfigureSessionRequest.safeParse({ idempotencyKey: key, permissionMode: 'bypassPermissions' }).success,
    ).toBe(false); // never offered from the app
  });
});
