import { createEvent, FolderListResponse } from '@pocket-agent/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  browser,
  connectAgent,
  createUserWithSession,
  deleteUser,
  pairDevice,
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

const WS = String.raw`C:\work`;

async function setup(agentVersion = '0.1.7') {
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
  await agent.send(
    createEvent('device.settings', { projects: [{ name: 'work', path: WS }], observedInstructions: false }),
  );
  return { ...u, ...d, agent };
}

const list = (s: { deviceId: string; cookie: string }, path: string) =>
  t.app.inject({
    method: 'GET',
    url: `/devices/${s.deviceId}/folders?path=${encodeURIComponent(path)}`,
    headers: browser(s.cookie),
  });

describe('browsing folders on the PC', () => {
  it('asks the PC live and returns its answer', async () => {
    const s = await setup();
    const pending = list(s, `${WS}\\app`);
    const frame = (await s.agent.next((m) => m['eventType'] === 'folder.list')) as {
      payload: { requestId: string; path: string };
    };
    expect(frame.payload.path).toBe(`${WS}\\app`);
    s.agent.sendRaw(
      createEvent('folder.listed', {
        requestId: frame.payload.requestId,
        folders: [{ name: 'src', path: `${WS}\\app\\src` }],
        truncated: false,
      }),
    );
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(FolderListResponse.parse(res.json())).toEqual({
      path: `${WS}\\app`,
      folders: [{ name: 'src', path: `${WS}\\app\\src` }],
      truncated: false,
    });
  });

  it('passes on the PC refusing', async () => {
    const s = await setup();
    const pending = list(s, WS);
    const frame = (await s.agent.next((m) => m['eventType'] === 'folder.list')) as {
      payload: { requestId: string };
    };
    s.agent.sendRaw(
      createEvent('folder.listed', { requestId: frame.payload.requestId, error: 'folder_not_found' }),
    );
    const res = await pending;
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'folder_not_found' });
  });

  it('never asks the PC about folders outside its project list', async () => {
    const s = await setup();
    const res = await list(s, String.raw`C:\Windows`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'project_not_allowed' });
    expect(s.agent.inbox.some((m) => m['eventType'] === 'folder.list')).toBe(false);
  });

  it('asks an older PC agent to update', async () => {
    const s = await setup('0.1.6');
    const res = await list(s, WS);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'agent_outdated' });
  });

  it("hides other users' PCs", async () => {
    const s = await setup();
    const other = await createUserWithSession(t.ctx);
    users.push(other.user.id);
    const res = await list({ deviceId: s.deviceId, cookie: other.cookie }, WS);
    expect(res.statusCode).toBe(404);
  });
});
