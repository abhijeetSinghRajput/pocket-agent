import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sign = (body: string) => createSign('RSA-SHA256').update(body, 'utf8').sign(privateKey, 'base64');
const RUNTIME = '2.4.1';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function make(files: Record<string, unknown>) {
  const asked: string[] = [];
  const fake = (async (url: string | URL | Request) => {
    const u = String(url);
    asked.push(u);
    const name = u.slice(u.lastIndexOf('/') + 1);
    return name in files
      ? new Response(JSON.stringify(files[name]), { status: 200 })
      : new Response('Not Found', { status: 404 });
  }) as typeof fetch;
  app = await buildApp({
    env: { WEB_ORIGINS: ['http://localhost:3000'], NODE_ENV: 'test' },
    health: { version: '0.0.0-test', probes: { database: async () => 1, redis: async () => 1 } },
    updates: { base: 'https://store.example/ota', fetch: fake, cacheMs: 0 },
  });
  return { app, asked };
}

const ask = (a: FastifyInstance, runtime = RUNTIME, extra: Record<string, string> = {}) =>
  a.inject({
    method: 'GET',
    url: '/updates/manifest',
    headers: {
      'expo-protocol-version': '1',
      'expo-platform': 'android',
      'expo-runtime-version': runtime,
      accept: 'multipart/mixed',
      ...extra,
    },
  });

/** The parts of a multipart/mixed answer: name, headers and body. */
function parts(contentType: string, body: string) {
  const boundary = /boundary=([^;]+)/.exec(contentType)![1]!;
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((raw) => {
      const [head, ...rest] = raw.replace(/^\r\n/, '').split('\r\n\r\n');
      const headers = Object.fromEntries(
        head!
          .split('\r\n')
          .map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]),
      );
      return {
        name: /name="([^"]+)"/.exec(headers['content-disposition'] ?? '')?.[1],
        headers,
        body: rest.join('\r\n\r\n').replace(/\r\n$/, ''),
      };
    });
}

describe('over-the-air updates', () => {
  it('passes on the manifest signed for this exact build; the signature verifies as the app checks it', async () => {
    const manifest = JSON.stringify({
      id: 'u1',
      runtimeVersion: RUNTIME,
      launchAsset: { key: 'k' },
      assets: [],
    });
    const { app, asked } = await make({
      [`manifest-${RUNTIME}.json`]: { kind: 'manifest', body: manifest, signature: sign(manifest) },
    });
    const res = await ask(app);
    expect(res.statusCode).toBe(200);
    expect(res.headers['expo-protocol-version']).toBe('1');
    expect(res.headers['cache-control']).toBe('private, max-age=0');
    expect(asked).toEqual([`https://store.example/ota/manifest-${RUNTIME}.json`]);
    const [m, ext] = parts(String(res.headers['content-type']), res.body);
    expect(m!.name).toBe('manifest');
    expect(m!.body).toBe(manifest); // byte for byte: the signature covers exactly this
    const sig = /sig="([^"]+)", keyid="main"/.exec(m!.headers['expo-signature']!)![1]!;
    expect(createVerify('RSA-SHA256').update(m!.body, 'utf8').verify(publicKey, sig, 'base64')).toBe(true);
    expect(ext!.name).toBe('extensions');
  });

  it('no update for this build: 204, and the app keeps what it has', async () => {
    const { app } = await make({});
    const res = await ask(app);
    expect(res.statusCode).toBe(204);
    expect(res.headers['expo-protocol-version']).toBe('1');
  });

  it('a signed rollback is passed on as a directive', async () => {
    const directive = JSON.stringify({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-11-25T00:00:00.000Z' },
    });
    const { app } = await make({
      [`manifest-${RUNTIME}.json`]: { kind: 'directive', body: directive, signature: sign(directive) },
    });
    const res = await ask(app);
    const [d] = parts(String(res.headers['content-type']), res.body);
    expect(d!.name).toBe('directive');
    expect(d!.body).toBe(directive);
  });

  it('anything that is not an update request is refused, and never reaches the store', async () => {
    const { app, asked } = await make({});
    expect((await ask(app, '../../secrets')).statusCode).toBe(400);
    expect((await ask(app, '55d61111991e41a6dea0db5749fb1e974e1bde9a')).statusCode).toBe(400); // only app versions
    expect((await ask(app, RUNTIME, { 'expo-platform': 'web' })).statusCode).toBe(400);
    expect((await ask(app, RUNTIME, { 'expo-protocol-version': '0' })).statusCode).toBe(400);
    expect(asked).toHaveLength(0);
  });
});
