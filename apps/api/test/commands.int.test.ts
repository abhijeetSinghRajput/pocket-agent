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

  it('expires commands that never reached the PC in time; a late report cannot revive them', async () => {
    const s = await setup();
    const { command } = (await instruct(s, 'slow')).json() as { command: { id: string } };
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

  it('never expires an instruction the PC has queued behind a long task', async () => {
    const s = await setup();
    const { command } = (await instruct(s, 'after the current task')).json() as { command: { id: string } };
    await s.agent.send(ackCmd(command.id, 'Accepted'));
    await t.ctx.prisma.command.update({
      where: { id: command.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const bus = createBus(t.ctx, t.app.log);
    await expireCommands({ ...t.ctx, bus });
    await bus.close();
    expect((await dbCommand(command.id)).status).toBe('Accepted');
    await s.agent.send(ackCmd(command.id, 'Executing'));
    expect((await dbCommand(command.id)).status).toBe('Executing');
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

describe('chats with another coding agent (Codex)', () => {
  const CODEX = {
    provider: 'codex' as const,
    version: '0.172.0',
    signedIn: true,
    models: [{ id: 'gpt-5.5-codex', name: 'GPT-5.5-Codex', description: '' }],
  };
  async function codexPc(agentVersion: string, codex: typeof CODEX | null = CODEX) {
    const s = await setup();
    await s.agent.send(
      createEvent('device.settings', {
        projects: [{ name: 'api', path: String.raw`C:\work\api` }],
        observedInstructions: false,
        ...(codex ? { agents: [codex] } : {}),
      }),
    );
    await waitFor(async () => {
      const d = await t.ctx.prisma.device.findUniqueOrThrow({ where: { id: s.deviceId } });
      return JSON.stringify(d.projects).includes('api');
    });
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agentVersion } });
    return s;
  }
  const startCodex = (s: { deviceId: string; cookie: string }, model?: string) =>
    post(`/devices/${s.deviceId}/sessions`, s.cookie, {
      provider: 'codex',
      projectPath: String.raw`C:\work\api`,
      text: 'Fix the build',
      ...(model ? { model } : {}),
      idempotencyKey: randomUUID(),
    });

  it('never reach an older PC agent (it would start Claude Code instead)', async () => {
    const s = await codexPc('2.4.2');
    const res = await startCodex(s);
    expect(res.statusCode).toBe(409);
    expect(await t.ctx.prisma.command.count({ where: { deviceId: s.deviceId } })).toBe(0);
    s.agent.ws.close();
  });

  it('go to the PC with the agent named, and its own model (not checked against Claude’s list)', async () => {
    const s = await codexPc('2.5.0');
    const res = await startCodex(s, 'gpt-5.5-codex');
    expect(res.statusCode).toBe(201);
    const frame = await s.agent.next(
      (m) =>
        m['eventType'] === 'command.execute' &&
        (m['payload'] as { commandType: string }).commandType === 'session.start',
    );
    expect(frame['payload']).toMatchObject({
      provider: 'codex',
      model: 'gpt-5.5-codex',
      text: 'Fix the build',
    });

    // The chat the PC reports is a Codex chat, and its messages may name Codex's models.
    const ext = randomUUID();
    await s.agent.send(
      sessionStarted(ext, { provider: 'codex', mode: 'managed', capabilities: MANAGED_CAPS }),
    );
    const chat = await t.ctx.prisma.agentSession.findUniqueOrThrow({
      where: { deviceId_externalSessionId: { deviceId: s.deviceId, externalSessionId: ext } },
    });
    const dto = await t.app.inject({
      method: 'GET',
      url: `/sessions/${chat.id}`,
      headers: { cookie: s.cookie },
    });
    expect(dto.json().session.provider).toBe('codex');
    const sent = await post(`/sessions/${chat.id}/instructions`, s.cookie, {
      text: 'and test it',
      model: 'gpt-5.5',
      idempotencyKey: randomUUID(),
    });
    expect(sent.statusCode).toBe(201);
    s.agent.ws.close();
  });

  it('only where the PC reported Codex installed and signed in, with one of its models', async () => {
    const missing = await codexPc('2.5.0', null);
    expect((await startCodex(missing)).json().error).toBe('provider_not_available');
    missing.agent.ws.close();

    const out = await codexPc('2.5.0', { ...CODEX, signedIn: false });
    expect((await startCodex(out)).json().error).toBe('provider_signed_out');
    out.agent.ws.close();

    const s = await codexPc('2.5.0');
    expect((await startCodex(s, 'claude-opus-5-5')).json().error).toBe('model_not_available');
    const devices = (
      await t.app.inject({ method: 'GET', url: '/devices', headers: { cookie: s.cookie } })
    ).json();
    expect(devices.devices[0].agents).toEqual([CODEX]);
    s.agent.ws.close();
  });

  it('an Antigravity chat reaches only PCs that know it (2.8.0), with it signed in', async () => {
    const AGY = { provider: 'antigravity' as const, version: '1.5.12', signedIn: true, models: [] };
    const s = await codexPc('2.7.0');
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agents: [AGY] } });
    const start = () =>
      post(`/devices/${s.deviceId}/sessions`, s.cookie, {
        provider: 'antigravity',
        projectPath: String.raw`C:\work\api`,
        text: 'Hi',
        idempotencyKey: randomUUID(),
      });
    const old = await start();
    expect(old.statusCode).toBe(409);
    expect(old.json().error).toBe('agent_outdated');
    await t.ctx.prisma.device.update({
      where: { id: s.deviceId },
      data: { agentVersion: '2.8.0', agents: [{ ...AGY, signedIn: false }] },
    });
    expect((await start()).json().error).toBe('provider_signed_out');
    s.agent.ws.close();
  });

  it('a Claude Code chat says nothing about the agent (older PCs read it as always)', async () => {
    const s = await codexPc('2.5.0');
    const res = await post(`/devices/${s.deviceId}/sessions`, s.cookie, {
      projectPath: String.raw`C:\work\api`,
      text: 'Set up',
      idempotencyKey: randomUUID(),
    });
    expect(res.statusCode).toBe(201);
    const frame = await s.agent.next(
      (m) =>
        m['eventType'] === 'command.execute' &&
        (m['payload'] as { commandType: string }).commandType === 'session.start',
    );
    expect(frame['payload']).not.toHaveProperty('provider');
    s.agent.ws.close();
  });
});

describe('continuing an ended session', () => {
  async function ended(agentVersion: string) {
    const s = await setup();
    // An ended session whose folder is NOT on the PC's project list.
    await t.ctx.prisma.agentSession.update({
      where: { id: s.session.id },
      data: { endedAt: new Date(), status: 'Stopped', projectPath: 'C:/not/on/the/list' },
    });
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agentVersion, projects: [] } });
    return s;
  }
  const resume = (s: { session: { id: string }; cookie: string }) =>
    post(`/sessions/${s.session.id}/resume`, s.cookie, { text: 'More work', idempotencyKey: randomUUID() });

  it('needs no project-list entry with a current agent (it runs where the conversation ran)', async () => {
    const s = await ended('0.1.5');
    const res = await resume(s);
    expect(res.statusCode).toBe(201);
    expect(CommandResponse.parse(res.json()).command).toMatchObject({ commandType: 'session.start' });
    s.agent.ws.close();
  });

  it('files go with it only to a PC that takes them (0.1.6+)', async () => {
    const s = await ended('0.1.5');
    const res = await post(`/sessions/${s.session.id}/resume`, s.cookie, {
      text: 'Look at this',
      idempotencyKey: randomUUID(),
      attachmentIds: [randomUUID()],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'agent_outdated' });
    s.agent.ws.close();
  });

  it('a Codex chat continues on a PC from 2.6.0 with Codex signed in, named for the PC', async () => {
    const CODEX = { provider: 'codex' as const, version: '0.172.0', signedIn: true, models: [] };
    const s = await ended('2.5.0');
    await t.ctx.prisma.agentSession.update({ where: { id: s.session.id }, data: { provider: 'codex' } });
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agents: [CODEX] } });
    const old = await resume(s);
    expect(old.statusCode).toBe(409);
    expect(old.json().error).toBe('agent_outdated');

    await t.ctx.prisma.device.update({
      where: { id: s.deviceId },
      data: { agentVersion: '2.6.0', agents: [{ ...CODEX, signedIn: false }] },
    });
    expect((await resume(s)).json().error).toBe('provider_signed_out');

    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agents: [CODEX] } });
    expect((await resume(s)).statusCode).toBe(201);
    const frame = await s.agent.next((m) => m['eventType'] === 'command.execute');
    expect(frame['sessionId']).toBe(s.ext);
    expect(frame['payload']).toMatchObject({ commandType: 'session.start', provider: 'codex', resume: true });
    s.agent.ws.close();
  });

  it('an older agent still needs the folder on the list', async () => {
    const s = await ended('0.1.4');
    const res = await resume(s);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'project_not_allowed' });
    s.agent.ws.close();
  });
});

describe('switching mode or model mid-task', () => {
  const configure = (s: { session: { id: string }; cookie: string }, body: object) =>
    post(`/sessions/${s.session.id}/configure`, s.cookie, { idempotencyKey: randomUUID(), ...body });

  it('reaches a running session the PC runs for Pocket Agent at once (PC agents from 0.1.8)', async () => {
    const s = await setup();
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agentVersion: '0.1.7' } });
    const old = await configure(s, { permissionMode: 'auto' });
    expect(old.statusCode).toBe(409);
    expect(old.json().error).toBe('agent_outdated');

    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agentVersion: '0.1.8' } });
    expect((await configure(s, {})).statusCode).toBe(400); // a mode or a model
    const res = await configure(s, { permissionMode: 'auto' });
    expect(res.statusCode).toBe(201);
    expect(CommandResponse.parse(res.json()).command).toMatchObject({
      commandType: 'session.configure',
      permissionMode: 'auto',
    });
    const frame = await s.agent.next((m) => m['eventType'] === 'command.execute');
    expect(frame['sessionId']).toBe(s.ext);
    expect(frame['payload']).toMatchObject({ commandType: 'session.configure', permissionMode: 'auto' });
    s.agent.ws.close();
  });

  it('is refused for a session started in the editor (it keeps the editor’s settings)', async () => {
    const s = await setup(MANAGED_CAPS, 'observed');
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agentVersion: '0.1.8' } });
    const res = await configure(s, { permissionMode: 'auto' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not_supported');
    s.agent.ws.close();
  });
});

describe('taking a waiting message back (edit)', () => {
  const withdraw = (s: { cookie: string }, id: string) => post(`/commands/${id}/withdraw`, s.cookie, {});
  async function queued(agentVersion = '2.1.0') {
    const s = await setup();
    await t.ctx.prisma.device.update({ where: { id: s.deviceId }, data: { agentVersion } });
    const res = await instruct(s, 'Also run the linter');
    const id = CommandResponse.parse(res.json()).command.id;
    await s.agent.next((m) => m['eventType'] === 'command.execute');
    await s.agent.send(ackCmd(id, 'Accepted'));
    return { s, id };
  }
  const answer = async (s: Awaited<ReturnType<typeof setup>>, withdrawn: boolean) => {
    const ask = (await s.agent.next((m) => m['eventType'] === 'command.withdraw')) as {
      payload: { requestId: string; commandId: string };
    };
    s.agent.sendRaw(createEvent('command.withdrawn', { requestId: ask.payload.requestId, withdrawn }));
    return ask.payload.commandId;
  };

  it('the PC takes it out of its queue: it ends withdrawn', async () => {
    const { s, id } = await queued();
    const pending = withdraw(s, id);
    expect(await answer(s, true)).toBe(id);
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(CommandResponse.parse(res.json()).command).toMatchObject({ status: 'Failed', error: 'withdrawn' });
    expect(await dbCommand(id)).toMatchObject({ status: 'Failed', error: 'withdrawn' });
  });

  it('Claude already started on it: nothing changes', async () => {
    const { s, id } = await queued();
    const pending = withdraw(s, id);
    await answer(s, false);
    const res = await pending;
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_started');
    expect((await dbCommand(id)).status).toBe('Accepted');
  });

  it('an older PC cannot take it back; someone else cannot either', async () => {
    const { s, id } = await queued('2.0.0');
    const res = await withdraw(s, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('agent_outdated');
    const other = await createUserWithSession(t.ctx);
    users.push(other.user.id);
    expect((await withdraw(other, id)).statusCode).toBe(404);
  });
});
