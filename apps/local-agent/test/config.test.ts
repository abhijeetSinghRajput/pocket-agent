import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentPlatform, validateApiUrl, wsUrlFor } from '../src/config.js';
import { backoffDelay } from '../src/link.js';
import { createSecretStore } from '../src/secret-store.js';

describe('validateApiUrl (TLS required for remote hosts)', () => {
  it('accepts https anywhere and http only on loopback', () => {
    expect(validateApiUrl('https://api.example.com').host).toBe('api.example.com');
    expect(validateApiUrl('http://localhost:4000').port).toBe('4000');
    expect(validateApiUrl('http://127.0.0.1:4000').hostname).toBe('127.0.0.1');
  });
  it('rejects plain http to remote hosts, credentials in URLs and other schemes', () => {
    expect(() => validateApiUrl('http://api.example.com')).toThrow(/https/);
    expect(() => validateApiUrl('http://192.168.1.10:4000')).toThrow(/https/);
    expect(() => validateApiUrl('https://user:pw@api.example.com')).toThrow(/credentials/);
    expect(() => validateApiUrl('ftp://x')).toThrow();
    expect(() => validateApiUrl('not a url')).toThrow(/Invalid/);
  });
  it('derives the websocket URL', () => {
    expect(wsUrlFor('https://api.example.com')).toBe('wss://api.example.com/ws/agent');
    expect(wsUrlFor('http://localhost:4000/')).toBe('ws://localhost:4000/ws/agent');
  });
});

describe('backoffDelay', () => {
  it('grows exponentially, is capped, and is jittered', () => {
    expect(backoffDelay(0, 1000, 30_000, () => 0.999)).toBe(999);
    expect(backoffDelay(3, 1000, 30_000, () => 0.999)).toBe(7992);
    expect(backoffDelay(20, 1000, 30_000, () => 0.999)).toBe(29_970);
    expect(backoffDelay(5, 1000, 30_000, () => 0)).toBe(0);
  });
});

describe('currentPlatform', () => {
  it('maps node platforms', () => {
    expect(currentPlatform('win32')).toBe('windows');
    expect(currentPlatform('darwin')).toBe('macos');
    expect(currentPlatform('linux')).toBe('linux');
  });
});

describe('secret store', () => {
  const secret = 'device-secret-' + 'x'.repeat(40);

  it.runIf(process.platform === 'win32')(
    'encrypts with Windows DPAPI (no plaintext on disk)',
    async () => {
      const home = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-dpapi-'));
      const store = createSecretStore(home, 'win32');
      await store.save(secret);
      const onDisk = readFileSync(path.join(home, 'credentials.dpapi'), 'utf8');
      expect(onDisk).not.toContain('device-secret');
      expect(Buffer.from(onDisk, 'base64').toString('latin1')).not.toContain('device-secret');
      expect(await store.load()).toBe(secret);
      await store.clear();
      expect(await store.load()).toBeNull();
    },
    30_000,
  );

  it.runIf(process.platform !== 'win32')('writes an owner-only file elsewhere', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-secret-'));
    const store = createSecretStore(home, 'linux');
    await store.save(secret);
    expect(statSync(path.join(home, 'credentials')).mode & 0o777).toBe(0o600);
    expect(await store.load()).toBe(secret);
  });
});
