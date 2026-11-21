import { CommandResponse, CommandListResponse, createEvent } from '@pocket-agent/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireCommands } from '../src/commands/service.js';
import { createBus } from '../src/realtime/bus.js';
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

const MANAGED_CAPS = {
  monitor: true,
  remoteApproval: true,
  instructAnytime: true,
  instructBetweenTurns: true,
  interrupt: true,
};
const OBSERVED_OFF = {
  monitor: true,
  remoteApproval: true,
  instructAnytime: false,
  instructBetweenTurns: false,
  interrupt: false,
};

async function setup(caps = MANAGED_CAPS, mode: 'managed' | 'observed' = 'managed') {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  const d = await pairDevice(t, u.cookie);
  const agent = await connectAgent(t, d);
  const ext = `sess-${randomUUID()}`;
  await agent.send(sessionStarted(ext, { mode, capabilities: caps }));
  const session = await t.ctx.prisma.agentSession.findUniqueOrThrow({
    where: { deviceId_externalSessionId: { deviceId: d.deviceId, externalSessionId: ext } },
  });
  return { ...u, ...d, agent, ext, session };
}

const post = (url: string, cookie: string, payload: object) =>
  t.app.inject({ method: 'POST', url, headers: browser(cookie), payload });
const instruct = (s: { session: { id: string }; cookie: string }, text: string, key = randomUUID()) =>
  post(`/sessions/${s.session.id}/instructions`, s.cookie, { text, idempotencyKey: key });
const ackCmd = (commandId: string, status: string, extra: object = {}) =>
  createEvent('command.ack', { commandId, status, ...extra });
const dbCommand = (id: string) => t.ctx.prisma.command.findUniqueOrThrow({ where: { id } });

describe('instructions', () => {
  it('reaches the right session on the PC and reports every state change to the browser', async () => {
    const s = await setup();
    const tab = wsClient(t.wsUrl.replace('/ws/agent', '/ws/client'), browser(s.cookie));
    await tab.opened;

    const res = await instruct(s, 'Run the tests and fix failures');
    expect(res.statusCode).toBe(201);
    const { command } = CommandResponse.parse(res.json());
    expect(command).toMatchObject({
      status: 'Pending',
      commandType: 'instruction',
      text: 'Run the tests and fix failures',
    });

    const frame = await s.agent.next((m) => m['eventType'] === 'command.execute');
    expect(frame['sessionId']).toBe(s.ext); // addressed to the session's id on the PC
    expect(frame['payload']).toMatchObject({
      commandId: command.id,
      commandType: 'instruction',
      text: 'Run the tests and fix failures',
    });

    for (const status of ['Delivered', 'Accepted', 'Executing', 'Completed']) {
      await s.agent.send(ackCmd(command.id, status));
      expect((await dbCommand(command.id)).status).toBe(status);
      await tab.next(
        (m) =>
          m['eventType'] === 'command.status.changed' &&
          (m['payload'] as { status: string }).status === status,
      );
    }
    const done = await dbCommand(command.id);
    expect(done.deliveredAt).not.toBeNull();
    expect(done.completedAt).not.toBeNull();

    const list = CommandListResponse.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: `/sessions/${s.session.id}/commands`,
          headers: { cookie: s.cookie },
        })
      ).json(),
    );
    expect(list.commands.map((c) => c.id)).toEqual([command.id]);

    const audit = await t.ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'command.created', targetId: command.id },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Run the tests'); // size, not content
    tab.ws.close();
    s.agent.ws.close();
  });

  it('is idempotent: a retried request with the same key returns the same command', async () => {
    const s = await setup();
    const key = randomUUID();
    const a = await instruct(s, 'once', key);
    const b = await instruct(s, 'once', key);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().command.id).toBe(a.json().command.id);
    expect(await t.ctx.prisma.command.count({ where: { sessionId: s.session.id } })).toBe(1);
    s.agent.ws.close();
  });

  it('fails immediately and clearly when the PC is offline (never queued to run later)', async () => {
    const s = await setup();
    s.agent.ws.close();
    await waitFor(
      async () =>
        (await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: s.deviceId } })).status === 'Offline',
    );
    const res = await instruct(s, 'are you there?');
    expect(res.statusCode).toBe(201);
    expect(res.json().command).toMatchObject({ status: 'Failed', error: 'device_offline' });
  });

  it('refuses instructions to sessions whose PC has not allowed them', async () => {
    const s = await setup(OBSERVED_OFF, 'observed');
    const res = await instruct(s, 'hello');
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('pocket-agent instructions enable');
    s.agent.ws.close();
  });

  it('sends the chosen model to the PC, and only models that PC offers', async () => {
    const s = await setup();
    // Unknown until the PC reports its models.
    const early = await post(`/sessions/${s.session.id}/instructions`, s.cookie, {
      text: 'hi',
      model: 'haiku',
      idempotencyKey: randomUUID(),
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toBe('model_not_available');

    await s.agent.send(
      createEvent('device.settings', {
        projects: [],
        observedInstructions: false,
        models: [
          { id: 'opus', name: 'Opus 5.5', description: 'For complex work' },
          { id: 'haiku', name: 'Haiku 5.5', description: 'Fastest' },
        ],
      }),
    );
    const devices = (
      await t.app.inject({ method: 'GET', url: '/devices', headers: { cookie: s.cookie } })
    ).json();
    expect(devices.devices[0].models.map((m: { id: string }) => m.id)).toEqual(['opus', 'haiku']);

    const res = await post(`/sessions/${s.session.id}/instructions`, s.cookie, {
      text: 'quick question',
      model: 'haiku',
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(201);
    expect(CommandResponse.parse(res.json()).command.model).toBe('haiku');
    const frame = await s.agent.next((m) => m['eventType'] === 'command.execute');
    expect(frame['payload']).toMatchObject({ text: 'quick question', model: 'haiku' });

    const bad = await post(`/sessions/${s.session.id}/instructions`, s.cookie, {
      text: 'x',
      model: 'gpt-something',
      idempotencyKey: randomUUID(),
    });
    expect(bad.statusCode).toBe(400);
    s.agent.ws.close();
  });

  it('passes the mode and effort chosen in the app, never "bypass permissions", and audits the mode', async () => {
    const s = await setup();
    const send = (extra: object) =>
      post(`/sessions/${s.session.id}/instructions`, s.cookie, {
        text: 'go',
        idempotencyKey: randomUUID(),
        ...extra,
      });
    expect((await send({ permissionMode: 'bypassPermissions' })).statusCode).toBe(400);
    expect((await send({ effort: 'extreme' })).statusCode).toBe(400);

    const res = await send({ permissionMode: 'plan', effort: 'high' });
    expect(res.statusCode).toBe(201);
    const { command } = CommandResponse.parse(res.json());
    expect(command).toMatchObject({ permissionMode: 'plan', effort: 'high' });
    const frame = await s.agent.next((m) => m['eventType'] === 'command.execute');
    expect(frame['payload']).toMatchObject({ permissionMode: 'plan', effort: 'high' });
    const audit = await t.ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'command.created', targetId: command.id },
    });
    expect(audit.metadata).toMatchObject({ permissionMode: 'plan' });
    s.agent.ws.close();
  });

  it('only sessions that can be stopped are interrupted or ended', async () => {
    const s = await setup({ ...OBSERVED_OFF, instructBetweenTurns: true }, 'observed');
    for (const action of ['interrupt', 'stop']) {
      const res = await post(`/sessions/${s.session.id}/${action}`, s.cookie, {
        idempotencyKey: randomUUID(),
      });
      expect(res.statusCode).toBe(409);
    }
    expect((await instruct(s, 'between turns is fine')).statusCode).toBe(201);
    s.agent.ws.close();
  });

  it('refuses ended sessions, other users and missing CSRF origin', async () => {
    const s = await setup();
    const other = await createUserWithSession(t.ctx);
    users.push(other.user.id);
    expect((await instruct({ session: s.session, cookie: other.cookie }, 'x')).statusCode).toBe(404);
    const noOrigin = await t.app.inject({
      method: 'POST',
      url: `/sessions/${s.session.id}/instructions`,
      headers: { cookie: s.cookie },
      payload: { text: 'x', idempotencyKey: randomUUID() },
    });
    expect(noOrigin.statusCode).toBe(403);
    await s.agent.send(
      createEvent('agent.session.ended', { externalSessionId: s.ext, reason: 'done' }, { sessionId: s.ext }),
    );
    expect((await instruct(s, 'too late')).statusCode).toBe(409);
    s.agent.ws.close();
  });
});

describe('command state machine on the server', () => {
  it('only moves forward and ignores acks from other devices', async () => {
    const s = await setup();
    const { command } = (await instruct(s, 'x')).json() as { command: { id: string } };
    await s.agent.send(ackCmd(command.id, 'Completed'));
    await s.agent.send(ackCmd(command.id, 'Accepted')); // late, out of order
    expect((await dbCommand(command.id)).status).toBe('Completed');

    const intruder = await setup();
    const { command: c2 } = (await instruct(s, 'y')).json() as { command: { id: string } };
    await intruder.agent.send(ackCmd(c2.id, 'Failed', { error: 'hijack' }));
    expect((await dbCommand(c2.id)).status).toBe('Pending');
    s.agent.ws.close();
    intruder.agent.ws.close();
  });

  it('expires commands that did not start in time; a late report cannot revive them', async () => {
    const s = await setup();
    const { command } = (await instruct(s, 'slow')).json() as { command: { id: string } };
    await s.agent.send(ackCmd(command.id, 'Accepted'));
    await t.ctx.prisma.command.update({
      where: { id: command.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const bus = createBus(t.ctx, t.app.log);
    expect(await expireCommands({ ...t.ctx, bus })).toBeGreaterThanOrEqual(1);
    await bus.close();
    expect((await dbCommand(command.id)).status).toBe('Expired');
    await s.agent.send(ackCmd(command.id, 'Executing'));
    expect((await dbCommand(command.id)).status).toBe('Expired');
    s.agent.ws.close();
  });

  it('re-sends commands that were still pending when the PC reconnects', async () => {
    const s = await setup();
    const { command } = (await instruct(s, 'deliver me')).json() as { command: { id: string } };
    s.agent.ws.close();
    const again = await connectAgent(t, s);
    const frame = await again.next((m) => m['eventType'] === 'command.execute');
    expect((frame['payload'] as { commandId: string }).commandId).toBe(command.id);
    again.ws.close();
  });
});

describe('starting managed sessions remotely', () => {
  it('only in folders the PC owner allow-listed, and links the new session', async () => {
    const s = await setup();
    const start = (projectPath: string) =>
      post(`/devices/${s.deviceId}/sessions`, s.cookie, {
        projectPath,
        text: 'Set up the repo',
        idempotencyKey: randomUUID(),
      });

    expect((await start(String.raw`C:\Users\dev\.ssh`)).json().error).toBe('project_not_allowed');

    await s.agent.send(
      createEvent('device.settings', {
        projects: [{ name: 'api', path: String.raw`C:\work\api` }],
        observedInstructions: false,
      }),
    );
    const devices = (
      await t.app.inject({ method: 'GET', url: '/devices', headers: { cookie: s.cookie } })
    ).json();
    expect(devices.devices[0]).toMatchObject({ projects: [{ name: 'api' }], observedInstructions: false });

    const res = await start(String.raw`C:\work\api`);
    expect(res.statusCode).toBe(201);
    const { command } = CommandResponse.parse(res.json());
    expect(command.sessionId).toBeNull();
    const frame = await s.agent.next(
      (m) =>
        m['eventType'] === 'command.execute' &&
        (m['payload'] as { commandType: string }).commandType === 'session.start',
    );
    expect(frame['payload']).toMatchObject({ projectPath: String.raw`C:\work\api`, text: 'Set up the repo' });

    const newExt = randomUUID();
    await s.agent.send(
      sessionStarted(newExt, {
        mode: 'managed',
        capabilities: MANAGED_CAPS,
        projectPath: String.raw`C:\work\api`,
        projectName: 'api',
      }),
    );
    await s.agent.send(ackCmd(command.id, 'Executing', { externalSessionId: newExt }));
    const linked = await t.app.inject({
      method: 'GET',
      url: `/commands/${command.id}`,
      headers: { cookie: s.cookie },
    });
    const created = await t.ctx.prisma.agentSession.findUniqueOrThrow({
      where: { deviceId_externalSessionId: { deviceId: s.deviceId, externalSessionId: newExt } },
    });
    expect(linked.json().command).toMatchObject({ status: 'Executing', sessionId: created.id });
    s.agent.ws.close();
  });
});
