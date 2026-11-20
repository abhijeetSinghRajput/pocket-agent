import { randomBytes, timingSafeEqual } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

const MAX_BODY = 1024 * 1024;

export interface IngestHandlers {
  hook(payload: Record<string, unknown>): void;
  listSessions(): unknown;
  startSession(body: {
    projectPath: string;
    prompt: string;
    model?: string;
  }): Promise<{ externalSessionId: string }>;
  stopSession(externalSessionId: string): Promise<boolean>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Local endpoint for the hook relay and the `agentdock` CLI. Never reachable from the network or
 * from web pages:
 * - binds 127.0.0.1 only, random port
 * - requires a per-run random token (stored in the user-only agent state dir)
 * - rejects requests carrying Origin / Sec-Fetch-* (i.e. sent by a browser) — blocks CSRF
 * - rejects unexpected Host headers — blocks DNS rebinding
 */
export class IngestServer {
  private server: Server | null = null;
  private readonly token = randomBytes(32).toString('base64url');
  port = 0;

  constructor(
    private readonly home: string,
    private readonly handlers: IngestHandlers,
  ) {}

  get endpointFile(): string {
    return path.join(this.home, 'ingest.json');
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    this.server = server;
    this.port = (server.address() as { port: number }).port;
    await writeFile(
      this.endpointFile,
      JSON.stringify({ port: this.port, token: this.token, pid: process.pid }),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  }

  async stop(): Promise<void> {
    await rm(this.endpointFile, { force: true });
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }

  private authorized(req: IncomingMessage): boolean {
    // Browsers always send Origin (on POST) and Sec-Fetch-Site; Node's fetch sends neither.
    // (Not Sec-Fetch-Mode: Node's fetch sends that one too.)
    if (req.headers.origin || req.headers['sec-fetch-site']) return false;
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return false;
    const presented = Buffer.from(String(req.headers['x-agentdock-token'] ?? ''));
    const expected = Buffer.from(this.token);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (!this.authorized(req)) return send(403, { error: 'forbidden' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'POST' && url.pathname === '/hook') {
        const body = await readJson(req);
        send(204); // answer immediately; the relay never waits on processing
        this.handlers.hook(body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/sessions')
        return send(200, this.handlers.listSessions());
      if (req.method === 'POST' && url.pathname === '/sessions') {
        const b = await readJson(req);
        if (typeof b['projectPath'] !== 'string' || typeof b['prompt'] !== 'string' || !b['prompt'].trim()) {
          return send(400, { error: 'projectPath and prompt are required' });
        }
        const r = await this.handlers.startSession({
          projectPath: b['projectPath'],
          prompt: b['prompt'],
          ...(typeof b['model'] === 'string' ? { model: b['model'] } : {}),
        });
        return send(201, r);
      }
      const stop = /^\/sessions\/([\w-]{1,200})\/stop$/.exec(url.pathname);
      if (req.method === 'POST' && stop) {
        return send((await this.handlers.stopSession(stop[1]!)) ? 204 : 404);
      }
      send(404, { error: 'not_found' });
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else send(500, { error: 'internal_error' });
    }
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
