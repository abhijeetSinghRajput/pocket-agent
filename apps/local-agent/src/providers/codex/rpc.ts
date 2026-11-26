import { spawn } from 'node:child_process';

/**
 * Talks to `codex app-server`: Codex's own interface for rich clients (its VS Code extension uses
 * it). JSON-RPC, one JSON object per line over the process's stdin/stdout. Nothing listens on a
 * port: only this PC agent, which started the process, can talk to it.
 */

/** A line pipe to an app-server (a real process, or a fake in tests). */
export interface Transport {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  /** Called once when the other side is gone (exited, crashed). */
  onClose(listener: (reason: string) => void): void;
  close(): void;
}

type Json = Record<string, unknown>;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** An error the app-server answered a request with. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

export class AppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closedReason: string | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly handlers: {
      /** A notification (no answer expected). */
      notification: (method: string, params: Json) => void;
      /** A request from the app-server (an approval…): resolve with the result to send back. */
      request: (method: string, params: Json) => Promise<unknown>;
      closed: (reason: string) => void;
    },
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void = () => undefined,
    /** Who answers (for messages), and whether every message names JSON-RPC 2.0 (ACP wants it). */
    private readonly peer: { name: string; jsonrpc: boolean } = { name: 'codex app-server', jsonrpc: false },
  ) {
    transport.onLine((line) => this.onLine(line));
    transport.onClose((reason) => {
      if (this.closedReason !== null) return;
      this.closedReason = reason;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`${this.peer.name} closed: ${reason}`));
      }
      this.pending.clear();
      handlers.closed(reason);
    });
  }

  get closed(): boolean {
    return this.closedReason !== null;
  }

  /** The handshake every connection starts with. */
  async initialize(version: string): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'pocket-agent', title: 'Pocket Agent', version },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.notify('initialized');
  }

  request<T = Json>(method: string, params: Json = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closedReason !== null) return Promise.reject(new Error(`${this.peer.name} is not running`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.peer.name} ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: Json): void {
    if (this.closedReason !== null) return;
    this.write(params === undefined ? { method } : { method, params });
  }

  private write(msg: Json): void {
    this.transport.write(JSON.stringify(this.peer.jsonrpc ? { jsonrpc: '2.0', ...msg } : msg));
  }

  close(): void {
    this.transport.close();
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      return this.log('warn', `${this.peer.name} sent something unreadable: ${line.slice(0, 120)}`);
    }
    const id = msg['id'];
    const method = typeof msg['method'] === 'string' ? msg['method'] : null;
    const params = (msg['params'] && typeof msg['params'] === 'object' ? msg['params'] : {}) as Json;
    // An answer to one of our requests.
    if (method === null && (typeof id === 'number' || typeof id === 'string')) {
      const p = this.pending.get(Number(id));
      if (!p) return;
      this.pending.delete(Number(id));
      clearTimeout(p.timer);
      const error = msg['error'] as { code?: number; message?: string } | undefined;
      if (error) p.reject(new RpcError(error.code ?? -1, error.message ?? 'request failed'));
      else p.resolve(msg['result']);
      return;
    }
    if (method === null) return;
    // A request from the app-server: always answered, with an error if we have none.
    if (id !== undefined && id !== null) {
      void this.handlers
        .request(method, params)
        .then((result) => this.write({ id, result }))
        .catch((err: Error) => this.write({ id, error: { code: -32601, message: err.message } }));
      return;
    }
    this.handlers.notification(method, params);
  }
}

/** The command that runs Codex on this PC (`codex`, or CODEX_PATH). */
export const codexCommand = () => process.env['CODEX_PATH'] || 'codex';

/**
 * Starts `codex app-server` as a child process. On Windows the npm shim is a .cmd file, which only
 * a shell can run; the arguments are fixed, so nothing from outside reaches that shell.
 */
export function spawnAppServer(): Transport {
  return spawnLines(codexCommand(), ['app-server'], process.platform === 'win32');
}

/**
 * A child process spoken to in lines on stdin/stdout (fixed arguments only). `shell` only for
 * npm's .cmd shims on Windows.
 */
export function spawnLines(
  command: string,
  args: string[],
  shell: boolean,
  /** Variables the agent must not inherit. */
  dropEnv: string[] = [],
): Transport {
  const env: NodeJS.ProcessEnv = { ...process.env, POCKET_AGENT_MANAGED_SESSION: '1' };
  for (const name of dropEnv) delete env[name];
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell,
    windowsHide: true,
    // POCKET_AGENT_MANAGED_SESSION lets Pocket Agent's own Claude hook relay ignore anything the
    // agent starts.
    env,
  });
  const lineListeners: Array<(line: string) => void> = [];
  const closeListeners: Array<(reason: string) => void> = [];
  let buffer = '';
  let stderr = '';
  let closed = false;
  const close = (reason: string) => {
    if (closed) return;
    closed = true;
    for (const l of closeListeners) l(reason);
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).replace(/\r$/, '');
      buffer = buffer.slice(i + 1);
      for (const l of lineListeners) l(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  child.on('error', (err) => close(err.message));
  child.on('exit', (code, signal) =>
    close(`exited (${signal ?? code})${stderr.trim() ? `: ${stderr.trim().split('\n').at(-1)}` : ''}`),
  );
  return {
    write: (line) => {
      if (!closed) child.stdin.write(line + '\n');
    },
    onLine: (l) => void lineListeners.push(l),
    onClose: (l) => void closeListeners.push(l),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}
