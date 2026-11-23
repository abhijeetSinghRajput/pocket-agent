import { createEvent, WorkerListResponse } from '@pocket-agent/protocol';
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

const tool = (
  type: 'started' | 'completed' | 'failed',
  ext: string,
  toolUseId: string,
  toolName: string,
  input: object = {},
) =>
  createEvent(
    `agent.tool.${type}` as 'agent.tool.started',
    {
      toolUseId,
      toolName,
      input: JSON.stringify(input),
      ...(type === 'completed' ? { output: 'ok' } : type === 'failed' ? { error: 'boom' } : {}),
    },
    { sessionId: ext },
  );

describe('GET /workers', () => {
  it('lists sub-agents and workflows with their status; a background one finishes by its task notification', async () => {
    const u = await createUserWithSession(t.ctx);
    users.push(u.user.id);
    const d = await pairDevice(t, u.cookie);
    const agent = await connectAgent(t, d);
    const ext = `sess-${crypto.randomUUID()}`;
    await agent.send(sessionStarted(ext, { projectName: 'shop' }));

    // A foreground sub-agent that finished, a background workflow still running, a plain tool call.
    await agent.send(
      tool('started', ext, 'tu_agent', 'Agent', {
        description: 'Find the upload code',
        subagent_type: 'Explore',
      }),
    );
    await agent.send(tool('completed', ext, 'tu_agent', 'Agent'));
    await agent.send(
      tool('started', ext, 'tu_flow', 'Workflow', { name: 'review-changes', description: 'Review the diff' }),
    );
    await agent.send(tool('completed', ext, 'tu_flow', 'Workflow'));
    await agent.send(tool('started', ext, 'tu_read', 'Read', { file_path: 'a.ts' }));

    const list = async () => {
      const r = await t.app.inject({ method: 'GET', url: '/workers', headers: browser(u.cookie) });
      expect(r.statusCode).toBe(200);
      return WorkerListResponse.parse(r.json()).workers;
    };
    let workers = await list();
    expect(workers.map((w) => [w.id, w.kind, w.status])).toEqual([
      ['tu_flow', 'workflow', 'running'],
      ['tu_agent', 'subagent', 'done'],
    ]);
    expect(workers[1]).toMatchObject({
      title: 'Find the upload code',
      label: 'Explore',
      projectName: 'shop',
    });

    // The workflow reports back in the conversation.
    await agent.send(
      createEvent(
        'agent.output',
        {
          role: 'user',
          text: '<task-notification><tool-use-id>tu_flow</tool-use-id><status>completed</status><summary>Workflow completed</summary></task-notification>',
        },
        { sessionId: ext },
      ),
    );
    workers = await list();
    expect(workers.find((w) => w.id === 'tu_flow')).toMatchObject({
      status: 'done',
      summary: 'Workflow completed',
    });

    // A background sub-agent: its tool call returns at once; the PC says when it really ends.
    await agent.send(
      tool('started', ext, 'tu_bg', 'Agent', { description: 'Run the e2e suite', run_in_background: true }),
    );
    await agent.send(tool('completed', ext, 'tu_bg', 'Agent'));
    expect((await list()).find((w) => w.id === 'tu_bg')).toMatchObject({
      status: 'running',
      background: true,
    });
    await agent.send(
      createEvent(
        'agent.worker.updated',
        { toolUseId: 'tu_bg', status: 'failed', summary: '2 tests failed' },
        { sessionId: ext },
      ),
    );
    expect((await list()).find((w) => w.id === 'tu_bg')).toMatchObject({
      status: 'failed',
      summary: '2 tests failed',
    });

    // Another user sees none of it.
    const other = await createUserWithSession(t.ctx);
    users.push(other.user.id);
    const r = await t.app.inject({ method: 'GET', url: '/workers', headers: browser(other.cookie) });
    expect(WorkerListResponse.parse(r.json()).workers).toEqual([]);
    agent.ws.close();
  });
});
