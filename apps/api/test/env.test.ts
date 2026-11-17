import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../src/env.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGINS: 'http://localhost:3000, https://app.example.com',
};

describe('loadEnv', () => {
  it('applies defaults and parses origins', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('127.0.0.1'); // never listen on the LAN unless explicitly configured
    expect(env.NODE_ENV).toBe('development');
    expect(env.WEB_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('names missing variables without echoing values', () => {
    try {
      loadEnv({ ...valid, DATABASE_URL: 'mysql://secret-password@host/db', REDIS_URL: undefined });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const msg = (err as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('REDIS_URL');
      expect(msg).not.toContain('secret-password');
    }
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ ...valid, PORT: '70000' })).toThrow(EnvError);
  });

  it('requires https origins in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/https/);
    expect(
      loadEnv({ ...valid, NODE_ENV: 'production', WEB_ORIGINS: 'https://app.example.com' }).NODE_ENV,
    ).toBe('production');
  });
});
