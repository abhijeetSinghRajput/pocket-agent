import { ApprovalListResponse, ApprovalResponse, createEvent } from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browser,
  connectAgent,
  createUserWithSession,
  deleteUser,
  pairDevice,
  sessionStarted,
  startTestApp,
  waitFor,
  wsClient,
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
  const ext = `sess-${randomUUID()}`;
  await agent.send(sessionStarted(ext, { mode: 'managed', projectName: 'checkout' }));
  return { ...u, ...d, agent, ext };
}

/** The PC holds a permission request for a remote decision. */
async function request(
  s: Awaited<ReturnType<typeof setup>>,
  opts: { awaitingRemote?: boolean; expiresIn?: number } = {},
) {
  const requestId = `toolu_${randomUUID()}`;
  await s.agent.send(
    createEvent(
      'agent.permission.requested',
      {
        toolUseId: requestId,
        toolName: 'Bash',
        input: '{"command":"npm publish"}',
        requestId,
        awaitingRemote: opts.awaitingRemote ?? true,
        expiresAt: new Date(Date.now() + (opts.expiresIn ?? 60_000)).toISOString(),
      },
      { sessionId: s.ext },
    ),
  );
  const list = ApprovalListResponse.parse(
    (await t.app.inject({ method: 'GET', url: '/approvals', headers: { cookie: s.cookie } })).json(),
  );
  return { requestId, approval: list.approvals.find((a) => a.requestId === requestId) };
}

const decide = (cookie: string, id: string, decision: 'allow' | 'deny', message?: string) =>
  t.app.inject({
    method: 'POST',
    url: `/approvals/${id}/decision`,
    headers: browser(cookie),
    payload: { decision, ...(message ? { message } : {}) },
  });
const dbApproval = (id: string) => t.ctx.prisma.approval.findUniqueOrThrow({ where: { id } });
const ackDecision = (approvalId: string, result: 'applied' | 'stale') =>
  createEvent('approval.decision.ack', { approvalId, result });

describe('remote approvals', () => {
  it('a held request appears, is decided once, and becomes Approved only after the PC applied it', async () => {
    const s = await setup();
    const tab = wsClient(t.wsUrl.replace('/ws/agent', '/ws/client'), browser(s.cookie));
    await tab.opened;
    const { requestId, approval } = await request(s);
    expect(approval).toMatchObject({
      status: 'Pending',
      toolName: 'Bash',
      input: '{"command":"npm publish"}',
      projectName: 'checkout',
      deviceName: 'Test PC',
      sessionMode: 'managed',
      decision: null,
    });
    await tab.next((m) => m['eventType'] === 'approval.created');

    const res = await decide(s.cookie, approval!.id, 'allow');
    expect(res.statusCode).toBe(200);
    expect(ApprovalResponse.parse(res.json()).approval).toMatchObject({
      status: 'Pending',
      decision: 'allow',
    });

    const frame = await s.agent.next((m) => m['eventType'] === 'approval.decision');
    expect(frame['sessionId']).toBe(s.ext);
    expect(frame['payload']).toEqual({ approvalId: approval!.id, requestId, decision: 'allow' });

    await s.agent.send(ackDecision(approval!.id, 'applied'));
    expect((await dbApproval(approval!.id)).status).toBe('Approved');
    await tab.next(
      (m) =>
        m['eventType'] === 'approval.updated' && (m['payload'] as { status: string }).status === 'Approved',
    );

    const actions = (await t.ctx.prisma.auditLog.findMany({ where: { targetId: approval!.id } })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(['approval.applied', 'approval.decided']);
    tab.ws.close();
    s.agent.ws.close();
  });

  it('rejects a second decision and replays, including racing double taps', async () => {
    const s = await setup();
    const { approval } = await request(s);
    const [a, b] = await Promise.all([
      decide(s.cookie, approval!.id, 'allow'),
      decide(s.cookie, approval!.id, 'deny'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const again = await decide(s.cookie, approval!.id, 'allow');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_decided');
    s.agent.ws.close();
  });

  it('passes a deny reason to Claude', async () => {
    const s = await setup();
    const { approval } = await request(s);
    await decide(s.cookie, approval!.id, 'deny', 'Not on a Friday');
    const frame = await s.agent.next((m) => m['eventType'] === 'approval.decision');
    expect(frame['payload']).toMatchObject({ decision: 'deny', message: 'Not on a Friday' });
    await s.agent.send(ackDecision(approval!.id, 'applied'));
    expect((await dbApproval(approval!.id)).status).toBe('Denied');
    s.agent.ws.close();
  });

  it('expired requests cannot be approved', async () => {
    const s = await setup();
    const { approval } = await request(s, { expiresIn: 50 });
    await new Promise((r) => setTimeout(r, 120));
    const res = await decide(s.cookie, approval!.id, 'allow');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('expired');
    expect((await dbApproval(approval!.id)).status).toBe('Expired');
    s.agent.ws.close();
  });

  it('a decision that reaches the PC too late is recorded as Cancelled, never Approved', async () => {
    const s = await setup();
    const { approval } = await request(s);
    await decide(s.cookie, approval!.id, 'allow');
    await s.agent.send(ackDecision(approval!.id, 'stale'));
    const a = await dbApproval(approval!.id);
    expect(a.status).toBe('Cancelled');
    expect(a.decision).toBe('allow'); // what the user chose is still on record
    s.agent.ws.close();
  });

  it('a request answered on the PC closes the approval', async () => {
    const s = await setup();
    const { requestId, approval } = await request(s);
    await s.agent.send(
      createEvent('agent.permission.resolved', { requestId, outcome: 'local' }, { sessionId: s.ext }),
    );
    expect((await dbApproval(approval!.id)).status).toBe('Cancelled');
    expect((await decide(s.cookie, approval!.id, 'allow')).statusCode).toBe(409);
    s.agent.ws.close();
  });

  it('does not consume the decision when the PC is offline', async () => {
    const s = await setup();
    const { approval } = await request(s);
    s.agent.ws.close();
    await waitFor(
      async () =>
        (await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: s.deviceId } })).status === 'Offline',
    );
    const res = await decide(s.cookie, approval!.id, 'allow');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('device_offline');
    expect((await dbApproval(approval!.id)).decision).toBeNull();
  });

  it('isolates users, ignores acks from other devices, and requires a trusted origin', async () => {
    const s = await setup();
    const other = await setup();
    const { approval } = await request(s);
    expect((await decide(other.cookie, approval!.id, 'allow')).statusCode).toBe(404);
    const noOrigin = await t.app.inject({
      method: 'POST',
      url: `/approvals/${approval!.id}/decision`,
      headers: { cookie: s.cookie },
      payload: { decision: 'allow' },
    });
    expect(noOrigin.statusCode).toBe(403);
    await decide(s.cookie, approval!.id, 'allow');
    await other.agent.send(ackDecision(approval!.id, 'applied')); // wrong device
    expect((await dbApproval(approval!.id)).status).toBe('Pending');
    s.agent.ws.close();
    other.agent.ws.close();
  });

  it('informational permission events do not create approvals', async () => {
    const s = await setup();
    const { approval } = await request(s, { awaitingRemote: false });
    expect(approval).toBeUndefined();
    s.agent.ws.close();
  });
});

describe('away mode', () => {
  it('is pushed to the PC on change and on every connect, and audited', async () => {
    const s = await setup();
    const res = await t.app.inject({
      method: 'POST',
      url: `/devices/${s.deviceId}/away`,
      headers: browser(s.cookie),
      payload: { awayMode: true },
    });
    expect(res.json().device.awayMode).toBe(true);
    const frame = await s.agent.next(
      (m) => m['eventType'] === 'config.update' && (m['payload'] as { awayMode: boolean }).awayMode,
    );
    expect(frame).toBeTruthy();
    s.agent.ws.close();
    const again = await connectAgent(t, s);
    await again.next(
      (m) => m['eventType'] === 'config.update' && (m['payload'] as { awayMode: boolean }).awayMode,
    );
    const audit = await t.ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'device.away_mode', targetId: s.deviceId },
    });
    expect(audit.metadata).toEqual({ awayMode: true });
    again.ws.close();
  });
});
