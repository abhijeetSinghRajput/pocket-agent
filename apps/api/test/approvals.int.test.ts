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
  opts: {
    awaitingRemote?: boolean;
    expiresIn?: number;
    toolName?: string;
    input?: string;
    remember?: string;
  } = {},
) {
  const requestId = `toolu_${randomUUID()}`;
  await s.agent.send(
    createEvent(
      'agent.permission.requested',
      {
        toolUseId: requestId,
        toolName: opts.toolName ?? 'Bash',
        input: opts.input ?? '{"command":"npm publish"}',
        requestId,
        awaitingRemote: opts.awaitingRemote ?? true,
        expiresAt: new Date(Date.now() + (opts.expiresIn ?? 60_000)).toISOString(),
        ...(opts.remember ? { remember: opts.remember } : {}),
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

  it('answers Claude’s question: only that tool, only the questions it asked', async () => {
    const s = await setup();
    const input = JSON.stringify({
      questions: [{ question: 'Rock, Paper or Scissors?', options: [{ label: 'Rock' }, { label: 'Paper' }] }],
    });
    const answer = (id: string, answers: Record<string, string>) =>
      t.app.inject({
        method: 'POST',
        url: `/approvals/${id}/decision`,
        headers: browser(s.cookie),
        payload: { decision: 'allow', answers },
      });

    // A permission request for anything else can't be "answered".
    const bash = await request(s);
    const refused = await answer(bash.approval!.id, { 'Rock, Paper or Scissors?': 'Rock' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('answers_not_supported');

    const q = await request(s, { toolName: 'AskUserQuestion', input });
    // Not a question Claude asked.
    expect((await answer(q.approval!.id, { 'Delete the repo?': 'Yes' })).json().error).toBe(
      'invalid_answers',
    );
    expect((await dbApproval(q.approval!.id)).decision).toBeNull(); // still answerable

    const ok = await answer(q.approval!.id, { 'Rock, Paper or Scissors?': 'Paper' });
    expect(ok.statusCode).toBe(200);
    const frame = await s.agent.next(
      (m) =>
        m['eventType'] === 'approval.decision' &&
        (m['payload'] as { requestId: string }).requestId === q.requestId,
    );
    expect(frame['payload']).toMatchObject({
      decision: 'allow',
      answers: { 'Rock, Paper or Scissors?': 'Paper' },
    });
    const audit = await t.ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'approval.decided', targetId: q.approval!.id },
    });
    expect(audit.metadata).toMatchObject({ answered: 1 });
    expect(JSON.stringify(audit.metadata)).not.toContain('Paper'); // that it was answered, not what
    s.agent.ws.close();
  });

  it('expired requests cannot be approved', async () => {
    const s = await setup();
    const { approval } = await request(s);
    // Past its deadline (set directly: a real 50ms deadline can pass before the test sees it).
    await t.ctx.prisma.approval.update({
      where: { id: approval!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
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
    const notice = () =>
      t.ctx.prisma.notification.findFirst({ where: { dedupeKey: `approval:${approval!.id}` } });
    await waitFor(async () => !!(await notice()));
    await s.agent.send(
      createEvent('agent.permission.resolved', { requestId, outcome: 'local' }, { sessionId: s.ext }),
    );
    expect((await dbApproval(approval!.id)).status).toBe('Cancelled');
    // Its "Permission needed" notification no longer counts as unread.
    expect((await notice())?.readAt).not.toBeNull();
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

  it('"allow for this session" goes to the PC only when the request offered it, and is on record', async () => {
    const s = await setup();
    const remember = (cookie: string, id: string) =>
      t.app.inject({
        method: 'POST',
        url: `/approvals/${id}/decision`,
        headers: browser(cookie),
        payload: { decision: 'allow', remember: true },
      });

    // Not offered (an older PC, or nothing safe to remember): only "allow once".
    const plain = await request(s);
    expect(plain.approval!.remember).toBeNull();
    const refused = await remember(s.cookie, plain.approval!.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('remember_not_offered');

    const offered = await request(s, { remember: 'Bash(npm test:*)' });
    expect(offered.approval!.remember).toBe('Bash(npm test:*)');
    expect((await remember(s.cookie, offered.approval!.id)).statusCode).toBe(200);
    const frame = await s.agent.next(
      (m) =>
        m['eventType'] === 'approval.decision' &&
        (m['payload'] as { approvalId?: string }).approvalId === offered.approval!.id,
    );
    expect(frame['payload']).toMatchObject({ decision: 'allow', remember: true });
    const log = await t.ctx.prisma.auditLog.findFirstOrThrow({
      where: { targetId: offered.approval!.id, action: 'approval.decided' },
    });
    expect(log.metadata).toMatchObject({ rememberedForSession: 'Bash(npm test:*)' });
    s.agent.ws.close();
  });
});
