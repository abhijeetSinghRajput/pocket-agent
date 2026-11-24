import {
  createEvent,
  EventPage,
  OverviewResponse,
  SessionListResponse,
  SessionResponse,
} from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pruneEvents } from '../src/jobs/retention.js';
import {
  browser,
  connectAgent,
  createUserWithSession,
  deleteUser,
  pairDevice,
  sessionStarted,
  startTestApp,
  waitFor,
  type TestApp,
} from './helpers.js';

let t: TestApp;
const users: string[] = [];
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  for (const id of users) await deleteUser(t.ctx, id);
  await t.close();
});

async function setup() {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  const d = await pairDevice(t, u.cookie);
  const agent = await connectAgent(t, d);
  return { ...u, ...d, agent };
}

const get = (url: string, cookie: string) => t.app.inject({ method: 'GET', url, headers: { cookie } });
const sid = () => `sess-${randomUUID()}`;
const dbSession = (deviceId: string, externalSessionId: string) =>
  t.ctx.prisma.agentSession.findUniqueOrThrow({
    where: { deviceId_externalSessionId: { deviceId, externalSessionId } },
  });

describe('session lifecycle from agent events', () => {
  it('records a session, its tool calls and status changes, and serves them to the owner', async () => {
    const s = await setup();
    const ext = sid();
    await s.agent.send(sessionStarted(ext));

    const list = SessionListResponse.parse((await get('/sessions', s.cookie)).json());
    expect(list.sessions).toHaveLength(1);
    const session = list.sessions[0]!;
    expect(session).toMatchObject({
      externalSessionId: ext,
      mode: 'observed',
      status: 'WaitingForInput',
      deviceName: 'Test PC',
      metadata: { entrypoint: 'claude-vscode' },
    });
    expect(session.capabilities.instructAnytime).toBe(false);

    const ev = (eventType: string, payload: Record<string, unknown>) =>
      createEvent(eventType, payload, { sessionId: ext }) as { eventId: string };
    await s.agent.send(
      ev('agent.session.updated', {
        externalSessionId: ext,
        status: 'Running',
        currentTask: 'Fix the tests',
      }),
    );
    await s.agent.send(
      ev('agent.tool.started', { toolUseId: 'toolu_1', toolName: 'Bash', input: '{"command":"npm test"}' }),
    );
    await s.agent.send(
      ev('agent.permission.requested', {
        toolUseId: 'toolu_1',
        toolName: 'Bash',
        input: '{}',
        requestId: 'toolu_1',
      }),
    );
    expect((await dbSession(s.deviceId, ext)).status).toBe('WaitingForPermission');
    await s.agent.send(ev('agent.permission.resolved', { requestId: 'toolu_1', outcome: 'local' }));
    await s.agent.send(
      ev('agent.tool.completed', { toolUseId: 'toolu_1', toolName: 'Bash', input: '{}', output: 'ok' }),
    );
    await s.agent.send(ev('agent.session.updated', { externalSessionId: ext, status: 'WaitingForInput' }));

    const detail = SessionResponse.parse((await get(`/sessions/${session.id}`, s.cookie)).json());
    expect(detail.session).toMatchObject({ status: 'WaitingForInput', currentTask: 'Fix the tests' });

    const page = EventPage.parse((await get(`/sessions/${session.id}/events`, s.cookie)).json());
    expect(page.events.map((e) => e.eventType)).toEqual([
      'agent.session.updated',
      'agent.tool.completed',
      'agent.permission.resolved',
      'agent.permission.requested',
      'agent.tool.started',
      'agent.session.updated',
      'agent.session.started',
    ]);
    s.agent.ws.close();
  });

  it('is idempotent: replayed events are acknowledged but stored once', async () => {
    const s = await setup();
    const ext = sid();
    const started = sessionStarted(ext);
    await s.agent.send(started);
    const tool = createEvent(
      'agent.tool.started',
      { toolUseId: 't', toolName: 'Read', input: '{}' },
      { sessionId: ext },
    );
    await s.agent.send(tool);
    await s.agent.send(tool); // replay after a reconnect
    await s.agent.send(started);
    const session = await dbSession(s.deviceId, ext);
    expect(await t.ctx.prisma.agentEvent.count({ where: { sessionId: session.id } })).toBe(2);
    expect(await t.ctx.prisma.agentSession.count({ where: { deviceId: s.deviceId } })).toBe(1);
    s.agent.ws.close();
  });

  it('acknowledges but drops events for sessions it was never told about', async () => {
    const s = await setup();
    await s.agent.send(
      createEvent(
        'agent.tool.started',
        { toolUseId: 't', toolName: 'Read', input: '{}' },
        { sessionId: sid() },
      ),
    );
    expect(await t.ctx.prisma.agentEvent.count({ where: { deviceId: s.deviceId } })).toBe(0);
    s.agent.ws.close();
  });

  it('rejects session events without a session id (not acknowledged)', async () => {
    const s = await setup();
    const bad = createEvent('agent.output', { role: 'assistant', text: 'hi' });
    s.agent.sendRaw(bad);
    const marker = createEvent('device.heartbeat', { activeSessions: 0 });
    await s.agent.send(marker); // processed in order, so the bad frame has been handled
    expect(
      s.agent.inbox.some((m) => (m['payload'] as { ackEventId?: string }).ackEventId === bad.eventId),
    ).toBe(false);
    s.agent.ws.close();
  });

  it('marks sessions Disconnected when the PC drops, and reconciles on reconnect', async () => {
    const s = await setup();
    const keep = sid();
    const gone = sid();
    await s.agent.send(sessionStarted(keep, { status: 'Running' }));
    await s.agent.send(sessionStarted(gone));
    s.agent.ws.close();
    await waitFor(async () => (await dbSession(s.deviceId, keep)).status === 'Disconnected');
    expect((await dbSession(s.deviceId, gone)).status).toBe('Disconnected');

    const again = await connectAgent(t, s);
    await again.send(
      createEvent('agent.sessions.snapshot', {
        sessions: [{ externalSessionId: keep, status: 'WaitingForInput' }],
      }),
    );
    expect((await dbSession(s.deviceId, keep)).status).toBe('WaitingForInput');
    const ended = await dbSession(s.deviceId, gone);
    expect(ended.status).toBe('Stopped');
    expect(ended.endedAt).not.toBeNull();
    expect(await t.ctx.prisma.agentSession.count({ where: { deviceId: s.deviceId } })).toBe(2); // no duplicates
    again.ws.close();
  });

  it('ends sessions on session.ended and reopens them when resumed', async () => {
    const s = await setup();
    const ext = sid();
    await s.agent.send(sessionStarted(ext));
    await s.agent.send(
      createEvent(
        'agent.session.ended',
        { externalSessionId: ext, reason: 'prompt_input_exit' },
        { sessionId: ext },
      ),
    );
    expect(await dbSession(s.deviceId, ext)).toMatchObject({ status: 'Stopped' });
    // A late event doesn't revive an ended session.
    await s.agent.send(
      createEvent(
        'agent.tool.started',
        { toolUseId: 'x', toolName: 'Read', input: '{}' },
        { sessionId: ext },
      ),
    );
    expect((await dbSession(s.deviceId, ext)).status).toBe('Stopped');

    await s.agent.send(sessionStarted(ext, { status: 'WaitingForInput' }));
    const resumed = await dbSession(s.deviceId, ext);
    expect(resumed.status).toBe('WaitingForInput');
    expect(resumed.endedAt).toBeNull();
    const active = SessionListResponse.parse((await get('/sessions?scope=active', s.cookie)).json());
    expect(active.sessions).toHaveLength(1);
    s.agent.ws.close();
  });

  it("ends a device's sessions when the device is revoked", async () => {
    const s = await setup();
    const ext = sid();
    await s.agent.send(sessionStarted(ext));
    await t.app.inject({ method: 'POST', url: `/devices/${s.deviceId}/revoke`, headers: browser(s.cookie) });
    expect(await dbSession(s.deviceId, ext)).toMatchObject({ status: 'Stopped' });
  });
});

describe('reading sessions and activity', () => {
  it('isolates users', async () => {
    const a = await setup();
    const b = await createUserWithSession(t.ctx);
    users.push(b.user.id);
    const ext = sid();
    await a.agent.send(sessionStarted(ext));
    await a.agent.send(
      createEvent('agent.output', { role: 'assistant', text: 'secret plan' }, { sessionId: ext }),
    );
    const id = (await dbSession(a.deviceId, ext)).id;

    expect((await get(`/sessions/${id}`, b.cookie)).statusCode).toBe(404);
    expect((await get(`/sessions/${id}/events`, b.cookie)).statusCode).toBe(404);
    expect(SessionListResponse.parse((await get('/sessions?scope=all', b.cookie)).json()).sessions).toEqual(
      [],
    );
    const activity = EventPage.parse((await get('/activity', b.cookie)).json());
    expect(JSON.stringify(activity)).not.toContain('secret plan');
    expect((await get('/sessions/not-a-uuid', a.cookie)).statusCode).toBe(404);
    a.agent.ws.close();
  });

  it('paginates the timeline with a cursor', async () => {
    const s = await setup();
    const ext = sid();
    await s.agent.send(sessionStarted(ext));
    for (let i = 0; i < 5; i++) {
      await s.agent.send(
        createEvent('agent.output', { role: 'assistant', text: `m${i}` }, { sessionId: ext }),
      );
    }
    const id = (await dbSession(s.deviceId, ext)).id;
    const p1 = EventPage.parse((await get(`/sessions/${id}/events?limit=4`, s.cookie)).json());
    expect(p1.events).toHaveLength(4);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = EventPage.parse(
      (await get(`/sessions/${id}/events?limit=4&before=${p1.nextCursor}`, s.cookie)).json(),
    );
    expect(p2.events).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    const all = [...p1.events, ...p2.events].map((e) => e.id);
    expect(new Set(all).size).toBe(6);
    s.agent.ws.close();
  });

  it('summarises the overview and the cross-session activity feed', async () => {
    const s = await setup();
    await s.agent.send(sessionStarted(sid(), { status: 'Running' }));
    await s.agent.send(sessionStarted(sid(), { status: 'WaitingForPermission' }));
    await s.agent.send(sessionStarted(sid(), { status: 'WaitingForInput', projectName: 'other' }));
    const o = OverviewResponse.parse((await get('/overview', s.cookie)).json());
    expect(o.devices).toEqual({ online: 1, total: 1 });
    expect(o.sessions).toMatchObject({ active: 3, running: 1, waitingForInput: 1, waitingForPermission: 1 });
    expect(o.recent[0]!.session?.deviceName).toBe('Test PC');
    s.agent.ws.close();
  });

  it('answers bad query parameters with 400, not 500', async () => {
    const s = await setup();
    for (const url of ['/sessions?scope=bogus', '/approvals?status=bogus', '/activity?limit=abc']) {
      const r = await get(url, s.cookie);
      expect(r.statusCode, url).toBe(400);
      expect(r.json(), url).toMatchObject({ error: 'invalid_request' });
    }
    s.agent.ws.close();
  });
});

describe('retention', () => {
  it('prunes events older than the retention window', async () => {
    const s = await setup();
    const ext = sid();
    await s.agent.send(sessionStarted(ext));
    const old = createEvent('agent.output', { role: 'assistant', text: 'old' }, { sessionId: ext });
    old.timestamp = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await s.agent.send(old);
    expect(await pruneEvents(t.ctx)).toBeGreaterThanOrEqual(1);
    const left = await t.ctx.prisma.agentEvent.findMany({ where: { deviceId: s.deviceId } });
    expect(left.map((e) => e.eventType)).toEqual(['agent.session.started']);
    s.agent.ws.close();
  });
});
