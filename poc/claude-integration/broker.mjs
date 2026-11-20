#!/usr/bin/env node
// Local broker (PoC stand-in for the Pocket Agent Local Agent).
// Listens on 127.0.0.1 only. Receives hook events from relay.mjs, holds
// PermissionRequest hooks open until a decision arrives (simulating the
// phone), and can inject a queued instruction via the Stop hook.
//
//   POST /hook                          <- relay.mjs
//   GET  /state                         sessions, events, pending approvals
//   GET  /discover                      live sessions from ~/.claude/sessions
//   POST /approvals/:id   {decision:"allow"|"deny", message?}
//   POST /sessions/:sid/instructions    {text}

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.POCKET_AGENT_BROKER_PORT ?? 47821);
const APPROVAL_TTL_MS = Number(process.env.APPROVAL_TTL_MS ?? 100_000);
const STOP_WAIT_MS = Number(process.env.STOP_WAIT_MS ?? 0);
const LOG = process.env.BROKER_LOG ?? path.join(import.meta.dirname, 'events.jsonl');

const sessions = new Map(); // session_id -> {cwd, status, lastEvent, transcript}
const events = [];
const approvals = new Map(); // id -> {id, session_id, tool_name, tool_input, status, expiresAt, resolve}
const instructionQueue = new Map(); // session_id -> [text]
const instructionWaiters = new Map(); // session_id -> resolve

const STATUS_BY_EVENT = {
  SessionStart: 'Running',
  UserPromptSubmit: 'Running',
  PreToolUse: 'Running',
  PostToolUse: 'Running',
  PostToolUseFailure: 'Running',
  PermissionRequest: 'WaitingForPermission',
  Stop: 'WaitingForInput',
  SessionEnd: 'Stopped',
};

function log(entry) {
  const line = { at: new Date().toISOString(), ...entry };
  events.push(line);
  fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
  console.log(`[broker] ${entry.kind} ${entry.event ?? ''} ${entry.session_id ?? ''} ${entry.detail ?? ''}`);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); }
    });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Passive discovery from Claude Code's own per-process registry.
// UNDOCUMENTED internal format: best-effort only. Never read *.key files.
function discover() {
  const dir = path.join(os.homedir(), '.claude', 'sessions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          pid: j.pid, sessionId: j.sessionId, cwd: j.cwd, kind: j.kind,
          entrypoint: j.entrypoint, status: j.status, version: j.version,
          name: j.name, alive: pidAlive(j.pid),
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

async function handleHook(h) {
  const sid = h.session_id;
  const ev = h.hook_event_name;
  const s = sessions.get(sid) ?? { cwd: h.cwd, transcript: h.transcript_path, firstSeen: Date.now() };
  s.status = STATUS_BY_EVENT[ev] ?? s.status;
  s.lastEvent = ev;
  sessions.set(sid, s);
  log({ kind: 'hook', event: ev, session_id: sid, detail: h.tool_name ?? h.source ?? h.reason ?? '', payload: h });

  if (ev === 'PermissionRequest') {
    const id = randomUUID();
    const decision = await new Promise((resolve) => {
      const a = {
        id, session_id: sid, tool_name: h.tool_name, tool_input: h.tool_input,
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + APPROVAL_TTL_MS, resolve,
      };
      approvals.set(id, a);
      log({ kind: 'approval.created', session_id: sid, detail: `${id} ${h.tool_name} ${JSON.stringify(h.tool_input)}` });
      setTimeout(() => {
        if (a.status === 'pending') { a.status = 'expired'; resolve(null); }
      }, APPROVAL_TTL_MS);
    });
    const a = approvals.get(id);
    log({ kind: 'approval.resolved', session_id: sid, detail: `${id} ${a.status}` });
    if (!decision) return undefined; // expired -> no output -> local prompt / default
    s.status = 'Running';
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: decision.behavior === 'allow'
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: decision.message ?? 'Denied remotely via Pocket Agent' },
      },
    };
  }

  if (ev === 'Stop') {
    let q = instructionQueue.get(sid) ?? [];
    if (!q.length && STOP_WAIT_MS > 0) {
      await new Promise((resolve) => {
        instructionWaiters.set(sid, resolve);
        setTimeout(resolve, STOP_WAIT_MS);
      });
      instructionWaiters.delete(sid);
      q = instructionQueue.get(sid) ?? [];
    }
    if (q.length) {
      const text = q.shift();
      s.status = 'Running';
      log({ kind: 'instruction.delivered', session_id: sid, detail: text });
      return { decision: 'block', reason: `New instruction from the user (via Pocket Agent): ${text}` };
    }
  }
  return undefined;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/hook') {
      return send(res, 200, await handleHook(await body(req)));
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      return send(res, 200, {
        sessions: Object.fromEntries(sessions),
        approvals: [...approvals.values()].map(({ resolve, ...a }) => a),
        events: events.map(({ payload, ...e }) => e),
      });
    }
    if (req.method === 'GET' && url.pathname === '/discover') return send(res, 200, discover());
    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/approvals\/([\w-]+)$/))) {
      const a = approvals.get(m[1]);
      const b = await body(req);
      if (!a) return send(res, 404, { error: 'unknown approval' });
      if (a.status !== 'pending') return send(res, 409, { error: `approval is ${a.status}` });
      if (Date.now() > a.expiresAt) { a.status = 'expired'; a.resolve(null); return send(res, 410, { error: 'expired' }); }
      a.status = b.decision === 'allow' ? 'approved' : 'denied';
      a.resolve({ behavior: b.decision === 'allow' ? 'allow' : 'deny', message: b.message });
      return send(res, 200, { id: a.id, status: a.status });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/sessions\/([\w-]+)\/instructions$/))) {
      const b = await body(req);
      const q = instructionQueue.get(m[1]) ?? [];
      q.push(String(b.text));
      instructionQueue.set(m[1], q);
      instructionWaiters.get(m[1])?.();
      log({ kind: 'instruction.queued', session_id: m[1], detail: b.text });
      return send(res, 202, { queued: q.length });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[broker] listening on 127.0.0.1:${PORT}`));
