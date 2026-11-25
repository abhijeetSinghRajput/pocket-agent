import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Over-the-air updates for the phone app, in Expo's open update protocol (v1), without Expo's
 * hosting.
 *
 * Each update is described by a manifest that is **signed on the owner's PC** (the private key
 * never leaves it) and published, with the update's files, as GitHub release assets
 * (`apps/mobile/scripts/ota.mjs`). This endpoint only fetches the signed manifest for the
 * phone's exact native build (its runtime version) and passes it on in the protocol's format; it
 * can't make or change one. The app checks the signature against the certificate it was built
 * with, and every file's hash, before using anything.
 *
 * A published file is `manifest-<runtimeVersion>.json`:
 *   { kind: 'manifest' | 'directive', body: '<exact signed JSON>', signature: '<base64>' }
 * (a directive is a signed "roll back to the code inside the APK").
 */

export interface UpdatesDeps {
  /** Where the signed manifests are published (a GitHub release's download URL). */
  base: string;
  /** Overridable for tests. */
  fetch?: typeof fetch;
  /** How long a fetched manifest is reused (ms). */
  cacheMs?: number;
}

const Published = z.object({
  kind: z.enum(['manifest', 'directive']),
  body: z.string().min(2).max(200_000),
  signature: z.string().regex(/^[A-Za-z0-9+/=]{100,2000}$/),
});
type Published = z.infer<typeof Published>;

/** A runtime version as the app sends it (a fingerprint hash, or a plain version). */
const RuntimeVersion = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);

export async function updatesRoutes(app: FastifyInstance, deps: UpdatesDeps): Promise<void> {
  const get = deps.fetch ?? fetch;
  const cacheMs = deps.cacheMs ?? 60_000;
  const cache = new Map<string, { at: number; value: Published | null }>();

  async function published(runtime: string): Promise<Published | null> {
    const hit = cache.get(runtime);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
    const res = await get(`${deps.base}/manifest-${runtime}.json`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    let value: Published | null = null;
    if (res.ok) value = Published.parse(await res.json());
    else if (res.status !== 404) throw new Error(`manifest store answered ${res.status}`);
    cache.set(runtime, { at: Date.now(), value });
    return value;
  }

  app.get('/updates/manifest', async (req, reply) => {
    const h = req.headers;
    const protocol = Number(h['expo-protocol-version'] ?? 0);
    const platform = h['expo-platform'];
    const runtime = RuntimeVersion.safeParse(h['expo-runtime-version']);
    if (protocol !== 1 || (platform !== 'android' && platform !== 'ios') || !runtime.success) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Not an Expo update request.' });
    }
    reply
      .header('expo-protocol-version', '1')
      .header('expo-sfv-version', '0')
      .header('cache-control', 'private, max-age=0');

    let update: Published | null;
    try {
      update = await published(runtime.data);
    } catch (err) {
      req.log.warn({ err }, 'update manifest unavailable');
      // Nothing new rather than an error: the app keeps the version it has.
      return reply.code(204).send();
    }
    if (!update) return reply.code(204).send();

    const boundary = `pocket-agent-${randomUUID()}`;
    const part = (name: string, body: string, signature?: string) =>
      [
        `--${boundary}`,
        'content-type: application/json; charset=utf-8',
        `content-disposition: form-data; name="${name}"`,
        ...(signature ? [`expo-signature: sig="${signature}", keyid="main"`] : []),
        '',
        body,
      ].join('\r\n');
    const body = [
      part(update.kind, update.body, update.signature),
      part('extensions', JSON.stringify({ assetRequestHeaders: {} })),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return reply.header('content-type', `multipart/mixed; boundary=${boundary}`).send(body);
  });
}
