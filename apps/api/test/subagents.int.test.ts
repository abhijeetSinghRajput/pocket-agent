import { createEvent, SubagentDetailResponse } from '@pocket-agent/protocol';
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

async function setup(agentVersion = '0.1.8') {
  const u = await createUserWithSession(t.ctx);
  users.push(u.user.id);
  const d = await pairDevice(t, u.cookie);
  const agent = await connectAgent(t, d);
  await agent.send(
    createEvent(
      'device.connected',
      { agentVersion, platform: 'windows', hostname: 'pc' },
      { deviceId: d.deviceId },
    ),
  );
  const ext = `sess-${randomUUID()}`;
  await agent.send(sessionStarted(ext));
  const session = await t.ctx.prisma.agentSession.findUniqueOrThrow({
    where: { deviceId_externalSessionId: { deviceId: d.deviceId, externalSessionId: ext } },
  });
  return { ...u, ...d, agent, ext, session };
}

const AGENT = {
  agentId: 'a1',
  toolUseId: 'toolu_root',
  parentToolUseId: null,
  type: 'Explore',
  description: 'Find the upload code',
  model: 'claude-opus-5-5',
  background: false,
  finished: true,
  depth: 1,
  startedAt: '2026-11-24T10:00:00.000Z',
  lastActivityAt: '2026-11-24T10:01:00.000Z',
  toolCalls: 1,
};

const read = (s: { session: { id: string }; cookie: string }, toolUseId: string) =>
  t.app.inject({
    method: 'GET',
    url: `/sessions/${s.session.id}/agents/${toolUseId}`,
    headers: browser(s.cookie),
  });

describe('the agent map, read live from the PC', () => {
  it('asks the PC about the session it knows, and returns the map and the transcript as chat events', async () => {
    const s = await setup();
    const pending = read(s, 'toolu_root');
    const frame = (await s.agent.next((m) => m['eventType'] === 'agents.read')) as {
      sessionId: string;
      payload: { requestId: string; toolUseId: string };
    };
    expect(frame.sessionId).toBe(s.ext); // the session's id on the PC
    expect(frame.payload.toolUseId).toBe('toolu_root');
    s.agent.sendRaw(
      createEvent('agents.read.result', {
        requestId: frame.payload.requestId,
        agents: [AGENT],
        events: [
          {
            id: 'a1-0',
            eventType: 'agent.output',
            payload: { role: 'user', text: 'Find where uploads happen.' },
            createdAt: '2026-11-24T10:00:00.000Z',
          },
        ],
        truncated: false,
      }),
    );
    const res = await pending;
    expect(res.statusCode).toBe(200);
    const body = SubagentDetailResponse.parse(res.json());
    expect(body.agent).toEqual(AGENT);
    expect(body.events[0]).toMatchObject({ sessionId: s.session.id, eventType: 'agent.output' });
    s.agent.ws.close();
  });

  it('says why when it can’t: an older PC, someone else’s session, an unknown agent', async () => {
    const old = await setup('0.1.7');
    const outdated = await read(old, 'toolu_root');
    expect(outdated.statusCode).toBe(409);
    expect(outdated.json().error).toBe('agent_outdated');
    old.agent.ws.close();

    const s = await setup();
    const other = await createUserWithSession(t.ctx);
    users.push(other.user.id);
    expect((await read({ session: s.session, cookie: other.cookie }, 'toolu_root')).statusCode).toBe(404);

    const pending = read(s, 'toolu_gone');
    const frame = (await s.agent.next((m) => m['eventType'] === 'agents.read')) as {
      payload: { requestId: string };
    };
    s.agent.sendRaw(
      createEvent('agents.read.result', { requestId: frame.payload.requestId, error: 'agent_not_found' }),
    );
    const res = await pending;
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('agent_not_found');
    s.agent.ws.close();
  });
});
