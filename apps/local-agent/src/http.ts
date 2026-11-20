import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Minimal JSON-over-HTTP for the CLI. Deliberately not Node's `fetch`: on Windows, exiting the
 * process (`process.exit`) while fetch's pooled keep-alive connection was still open crashed the
 * CLI with a libuv assertion (exit 0xC0000409) instead of a clean error. Here every request uses
 * its own connection (`agent: false`) that is closed when the response ends, so nothing is left
 * open when the CLI exits.
 */
export function requestJson(
  url: URL,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<{ status: number; body: unknown }> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: init.method,
        agent: false,
        headers: {
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-length': Buffer.byteLength(init.body) } : {}),
          ...init.headers,
        },
        timeout: init.timeoutMs ?? 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(init.body);
  });
}
