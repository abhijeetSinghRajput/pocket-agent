import {
  BackendToAgent,
  createEvent,
  deviceAuthHeader,
  HEARTBEAT_INTERVAL_MS,
  MAX_FRAME_BYTES,
  WS_CLOSE,
  type Platform,
} from '@agentdock/protocol';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import WebSocket from 'ws';
import { wsUrlFor } from './config.js';

export interface LinkOptions {
  apiUrl: string;
  deviceId: string;
  secret: string;
  agentVersion: string;
  platform: Platform;
  heartbeatMs?: number;
  /** Live session count reported with each heartbeat. */
  activeSessions?: () => number;
  backoff?: { baseMs: number; maxMs: number };
}

/** Exponential backoff with full jitter: random in [0, min(max, base·2^attempt)]. */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 30_000, rand = Math.random): number {
  return Math.floor(rand() * Math.min(maxMs, baseMs * 2 ** attempt));
}

type StopReason = 'revoked' | 'replaced' | 'stopped' | 'unauthorized';

export interface LinkEvents {
  connected: [];
  disconnected: [code: number, willRetry: boolean, retryInMs: number];
  stopped: [reason: StopReason];
  message: [msg: BackendToAgent];
  log: [level: 'info' | 'warn' | 'error', msg: string];
}

/**
 * Outbound, authenticated WebSocket to the AgentDock API. Reconnects forever with backoff,
 * except when the server says the credentials are no longer valid (revoked / unauthorized)
 * or another process for the same device took over (replaced).
 */
export class AgentLink extends EventEmitter<LinkEvents> {
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(private readonly opts: LinkOptions) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.finish('stopped');
    this.ws?.close(1000, 'agent stopping');
  }

  private finish(reason: StopReason): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.clearHeartbeat();
    this.emit('stopped', reason);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Sends now if connected; returns false otherwise (callers keep their own retry queue). */
  send(msg: unknown): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  private connect(): void {
    const { apiUrl, deviceId, secret } = this.opts;
    const ws = new WebSocket(wsUrlFor(apiUrl), {
      headers: { authorization: deviceAuthHeader(deviceId, secret) },
      maxPayload: MAX_FRAME_BYTES,
      handshakeTimeout: 15_000,
    });
    this.ws = ws;
    let authRejected = false;

    ws.on('unexpected-response', (_req, res) => {
      authRejected = res.statusCode === 401;
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => {
        if (authRejected) this.finish(body.includes('device_revoked') ? 'revoked' : 'unauthorized');
        ws.terminate();
      });
    });

    ws.on('open', () => {
      this.attempt = 0;
      this.emit('connected');
      this.send(
        createEvent(
          'device.connected',
          { agentVersion: this.opts.agentVersion, platform: this.opts.platform, hostname: os.hostname() },
          { deviceId },
        ),
      );
      const every = this.opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
      lastHeard = Date.now();
      this.heartbeat = setInterval(() => {
        // Half-open connection (e.g. Wi-Fi dropped silently): the server acks every heartbeat and
        // pings every 15s, so silence for 3 intervals means the link is dead. Reconnect.
        if (Date.now() - lastHeard > every * 3) {
          this.emit('log', 'warn', 'no response from server; reconnecting');
          ws.terminate();
          return;
        }
        this.send(
          createEvent(
            'device.heartbeat',
            { activeSessions: this.opts.activeSessions?.() ?? 0 },
            { deviceId },
          ),
        );
      }, every);
    });

    let lastHeard = Date.now();
    ws.on('ping', () => (lastHeard = Date.now()));
    ws.on('pong', () => (lastHeard = Date.now()));

    ws.on('message', (data) => {
      lastHeard = Date.now();
      let parsed;
      try {
        parsed = BackendToAgent.safeParse(JSON.parse(data.toString()));
      } catch {
        return this.emit('log', 'warn', 'ignored non-JSON message from server');
      }
      if (!parsed.success) return this.emit('log', 'warn', 'ignored off-contract message from server');
      this.emit('message', parsed.data);
    });

    ws.on('error', (err) => this.emit('log', 'warn', `connection error: ${err.message}`));

    ws.on('close', (code) => {
      this.clearHeartbeat();
      if (code === WS_CLOSE.REVOKED) this.finish('revoked');
      if (code === WS_CLOSE.REPLACED) this.finish('replaced');
      if (this.stopped || authRejected) {
        this.emit('disconnected', code, false, 0);
        return;
      }
      const { baseMs, maxMs } = this.opts.backoff ?? { baseMs: 1_000, maxMs: 30_000 };
      // Never retry instantly in a tight loop: at least 250ms.
      const delay = Math.max(250, backoffDelay(this.attempt++, baseMs, maxMs));
      this.emit('disconnected', code, true, delay);
      this.retry = setTimeout(() => this.connect(), delay);
    });
  }
}
