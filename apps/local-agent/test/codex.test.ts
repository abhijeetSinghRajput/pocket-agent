import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from '../src/approvals.js';
import { codexAccount, codexVersion, detectCodex } from '../src/providers/codex/detect.js';
import type { Transport } from '../src/providers/codex/rpc.js';
import { CodexSessions, codexInput } from '../src/providers/codex/sessions.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Json = Record<string, unknown>;

/**
 * A stand-in for `codex app-server`, speaking its JSON-RPC lines: answers requests, and lets the
 * test send notifications and requests like Codex would during a turn.
 */
function fakeAppServer(opts: { signedIn?: boolean; resumeCwd?: string } = {}) {
  const sent: Json[] = [];
  let lineListener: (line: string) => void = () => undefined;
  let closeListener: (reason: string) => void = () => undefined;
  let turn = 0;
  const emit = (msg: Json) => lineListener(JSON.stringify(msg));
  const answers: Json[] = [];
  const transport: Transport = {
    write: (line) => {
      const msg = JSON.parse(line) as Json;
      sent.push(msg);
      const id = msg['id'];
      const method = msg['method'];
      if (method === undefined) return void answers.push(msg); // our answer to a server request
      if (id === undefined) return; // a notification
      const result =
        method === 'initialize'
          ? { userAgent: 'pocket-agent/0.172.0 (Windows 10.0.26200; x86_64)' }
          : method === 'thread/start'
            ? { thread: { id: 'th-1' }, model: 'gpt-6.2-sol' }
            : method === 'thread/resume'
              ? {
                  thread: { id: (msg['params'] as Json)['threadId'] },
                  model: 'gpt-6.2-sol',
                  cwd: opts.resumeCwd ?? '',
                }
              : method === 'turn/start'
                ? { turn: { id: `tu-${++turn}` } }
                : method === 'account/read'
                  ? {
                      account: opts.signedIn
                        ? { type: 'chatgpt', email: 'me@example.com', planType: 'plus' }
                        : null,
                    }
                  : method === 'model/list'
                    ? {
                        data: [
                          {
                            id: 'gpt-6.2-sol',
                            displayName: 'GPT-6.2-Sol',
                            description: 'Fast',
                            hidden: false,
                          },
                          { id: 'internal', displayName: 'Hidden', description: '', hidden: true },
                        ],
                      }
                    : {};
      queueMicrotask(() => emit({ id, result }));
    },
    onLine: (l) => void (lineListener = l),
    onClose: (l) => void (closeListener = l),
    close: () => closeListener('closed'),
  };
  const requests = (method: string) => sent.filter((m) => m['method'] === method && m['id'] !== undefined);
  return { transport, emit, sent, requests, answers, crash: () => closeListener('exited (1)') };
}

function harness(opts: { remote?: boolean; waitMs?: number } = {}) {
  const project = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-codex-'));
  const events: Json[] = [];
  const registry = new SessionRegistry((e) => events.push(e as unknown as Json));
  const acks: Array<{ id: string; status: string; extra?: Json }> = [];
  const server = fakeAppServer();
  const broker = new ApprovalBroker();
  const codex = new CodexSessions(
    registry,
    () => server.transport,
    '2.5.0',
    () => undefined,
    ((id: string, status: string, extra?: Json) =>
      acks.push({ id, status, ...(extra ? { extra } : {}) })) as never,
    Date.now,
    opts.remote === undefined
      ? undefined
      : { broker, enabled: () => opts.remote!, waitMs: opts.waitMs ?? 5000 },
  );
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const of = (type: string) => events.filter((e) => e['eventType'] === type).map((e) => e['payload'] as Json);
  const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
  return { project, registry, server, codex, tick, of, acks, statuses, broker };
}

describe('Codex chats', () => {
  it('start a thread in the project with Codex’s own protection, and say who the user is', async () => {
    const h = harness();
    const id = await h.codex.start({
      projectPath: h.project,
      prompt: 'fix the build',
      commandId: 'c1',
      model: 'gpt-6.2-sol',
    });
    expect(id).toBe('th-1');
    const [start] = h.server.requests('thread/start');
    expect(start!['params']).toMatchObject({
      cwd: path.resolve(h.project),
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      model: 'gpt-6.2-sol',
    });
    expect(String((start!['params'] as Json)['developerInstructions'])).toContain('Pocket Agent');
    expect(h.registry.get('th-1')).toMatchObject({ provider: 'codex', mode: 'managed', status: 'Running' });
    await h.tick();
    const [turn] = h.server.requests('turn/start');
    expect(turn!['params']).toMatchObject({
      threadId: 'th-1',
      input: [{ type: 'text', text: 'fix the build' }],
      model: 'gpt-6.2-sol',
    });
  });

  it('reports what Codex does in the app’s words, and only paths and summaries', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    const n = (method: string, params: Json) =>
      h.server.emit({ method, params: { threadId: 'th-1', turnId: 'tu-1', ...params } });
    n('turn/started', { turn: { id: 'tu-1' } });
    n('item/started', {
      item: { type: 'commandExecution', id: 'i1', command: 'npm test', status: 'inProgress' },
    });
    n('item/completed', {
      item: {
        type: 'commandExecution',
        id: 'i1',
        command: 'npm test',
        status: 'completed',
        aggregatedOutput: '3 passed',
        exitCode: 0,
      },
    });
    n('item/completed', {
      item: {
        type: 'fileChange',
        id: 'i2',
        status: 'completed',
        changes: [
          { path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: 'SECRET CONTENT' },
          { path: 'src/b.ts', kind: { type: 'add' }, diff: 'NEW FILE BODY' },
        ],
      },
    });
    n('item/completed', { item: { type: 'agentMessage', id: 'i3', text: 'Fixed: the build passes.' } });
    n('turn/completed', { turn: { id: 'tu-1', status: 'completed', error: null } });

    expect(h.of('agent.tool.started')[0]).toMatchObject({ toolUseId: 'i1', toolName: 'Bash' });
    expect(String(h.of('agent.tool.started')[0]!['input'])).toContain('npm test');
    const done = h.of('agent.tool.completed');
    expect(done.map((d) => d['toolName'])).toEqual(['Bash', 'Edit', 'Write']);
    expect(String(done[0]!['output'])).toContain('3 passed');
    expect(String(done[1]!['input'])).toContain('src/a.ts');
    expect(JSON.stringify(h.of('agent.tool.completed'))).not.toContain('SECRET CONTENT');
    expect(h.of('agent.output').map((o) => [o['role'], o['text']])).toEqual([
      ['user', 'go'],
      ['assistant', 'Fixed: the build passes.'],
    ]);
    expect(h.registry.get('th-1')?.status).toBe('WaitingForInput');
    expect(h.statuses('c1')).toEqual(['Completed']);
  });

  it('a chosen mode becomes Codex’s own settings, every turn; never full access', async () => {
    const h = harness();
    await h.codex.start({
      projectPath: h.project,
      prompt: 'look around',
      commandId: 'c1',
      permissionMode: 'plan',
    });
    expect(h.server.requests('thread/start')[0]!['params']).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'read-only',
    });
    await h.tick();
    expect(h.server.requests('turn/start')[0]!['params']).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });
    h.server.emit({ method: 'turn/started', params: { threadId: 'th-1', turn: { id: 'tu-1' } } });
    // Switched to Manual for the next message: Codex asks before most commands.
    expect(await h.codex.configure('th-1', { permissionMode: 'default' })).toBe(true);
    h.codex.send('th-1', 'now fix it', { commandId: 'c2', expiresAt: Infinity });
    h.server.emit({
      method: 'turn/completed',
      params: { threadId: 'th-1', turn: { id: 'tu-1', status: 'completed' } },
    });
    await h.tick();
    expect(h.server.requests('turn/start')[1]!['params']).toMatchObject({
      approvalPolicy: 'untrusted',
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
    });
    expect(JSON.stringify(h.server.sent)).not.toMatch(/never|dangerFullAccess|danger-full-access/);
  });

  it('runs queued messages one turn at a time, in order', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'first', commandId: 'c1' });
    await h.tick();
    h.server.emit({ method: 'turn/started', params: { threadId: 'th-1', turn: { id: 'tu-1' } } });
    expect(
      h.codex.send('th-1', 'second', {
        commandId: 'c2',
        expiresAt: Infinity,
        model: 'gpt-6.2-mini',
        effort: 'high',
      }),
    ).toBe(true);
    await h.tick();
    expect(h.server.requests('turn/start')).toHaveLength(1); // still busy with the first
    expect(h.statuses('c2')).toEqual(['Accepted']);
    h.server.emit({
      method: 'turn/completed',
      params: { threadId: 'th-1', turn: { id: 'tu-1', status: 'completed' } },
    });
    await h.tick();
    const turns = h.server.requests('turn/start');
    expect(turns).toHaveLength(2);
    expect(turns[1]!['params']).toMatchObject({
      input: [{ text: 'second' }],
      model: 'gpt-6.2-mini',
      effort: 'high',
    });
    expect(h.statuses('c2')).toEqual(['Accepted', 'Executing']);
  });

  it('stops a turn from the phone, and declines going beyond the sandbox (with a word in the chat)', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.emit({ method: 'turn/started', params: { threadId: 'th-1', turn: { id: 'tu-1' } } });
    // Codex asks to run something its sandbox doesn't allow.
    h.server.emit({
      id: 99,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'th-1', turnId: 'tu-1', itemId: 'i9', command: 'curl example.com' },
    });
    await h.tick();
    expect(h.server.answers).toContainEqual({ id: 99, result: { decision: 'decline' } });
    expect(JSON.stringify(h.of('agent.output'))).toContain('declined');

    expect(await h.codex.interrupt('th-1')).toBe(true);
    expect(h.server.requests('turn/interrupt')[0]!['params']).toEqual({ threadId: 'th-1', turnId: 'tu-1' });
    h.server.emit({
      method: 'turn/completed',
      params: { threadId: 'th-1', turn: { id: 'tu-1', status: 'interrupted' } },
    });
    expect(h.registry.get('th-1')?.status).toBe('WaitingForInput');
    expect(h.statuses('c1')).toEqual(['Failed']);
  });

  it('a waiting message can be taken back; ending the chat fails what still waits', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.emit({ method: 'turn/started', params: { threadId: 'th-1', turn: { id: 'tu-1' } } });
    h.codex.send('th-1', 'later', { commandId: 'c2', expiresAt: Infinity });
    h.codex.send('th-1', 'even later', { commandId: 'c3', expiresAt: Infinity });
    expect(h.codex.withdraw('c2')).toBe(true);
    expect(h.acks.find((a) => a.id === 'c2' && a.status === 'Failed')?.extra).toEqual({ error: 'withdrawn' });
    expect(await h.codex.stop('th-1')).toBe(true);
    expect(h.statuses('c3')).toEqual(['Accepted', 'Failed']);
    expect(h.codex.isManaged('th-1')).toBe(false);
    expect(h.registry.get('th-1')).toBeUndefined();
  });

  it('a crashed app-server ends its chats instead of leaving them hanging', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.crash();
    expect(h.statuses('c1')).toEqual(['Failed']);
    expect(h.codex.isManaged('th-1')).toBe(false);
  });

  it('a failed turn says why', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.emit({
      method: 'turn/completed',
      params: {
        threadId: 'th-1',
        turn: { id: 'tu-1', status: 'failed', error: { message: 'Sign in to Codex' } },
      },
    });
    expect(h.of('agent.error').at(-1)).toMatchObject({ message: 'Sign in to Codex' });
    expect(h.registry.get('th-1')?.status).toBe('Failed');
    expect(h.acks.at(-1)).toMatchObject({ id: 'c1', status: 'Failed' });
  });

  it('continues an ended chat: Codex reloads the thread, in the folder it ran in, with the same protection', async () => {
    const h = harness();
    const id = await h.codex.start({
      projectPath: h.project,
      prompt: 'and now the tests',
      commandId: 'c9',
      resumeSessionId: 'th-old',
    });
    expect(id).toBe('th-old');
    expect(h.server.requests('thread/start')).toHaveLength(0);
    expect(h.server.requests('thread/resume')[0]!['params']).toMatchObject({
      threadId: 'th-old',
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      excludeTurns: true,
    });
    expect(h.registry.get('th-old')).toMatchObject({ provider: 'codex', mode: 'managed' });
    await h.tick();
    expect(h.server.requests('turn/start')[0]!['params']).toMatchObject({
      threadId: 'th-old',
      input: [{ text: 'and now the tests' }],
    });
  });

  it('pictures Codex looks at or makes show in the chat by path (the picture stays on the PC)', async () => {
    const h = harness();
    await h.codex.start({ projectPath: h.project, prompt: 'draw', commandId: 'c1' });
    await h.tick();
    const done = (item: Json) =>
      h.server.emit({ method: 'item/completed', params: { threadId: 'th-1', item } });
    done({ type: 'imageView', id: 'v1', path: 'C:/shots/home.png' });
    done({
      type: 'imageGeneration',
      id: 'g1',
      status: 'completed',
      revisedPrompt: 'A robot in a pocket',
      savedPath: 'C:/out/robot.png',
      result: 'BASE64PIXELS',
      failure: null,
      generationId: null,
    });
    const tools = h.of('agent.tool.completed');
    expect(tools.map((t) => t['toolName'])).toEqual(['Read', 'ImageGeneration']);
    expect(String(tools[0]!['input'])).toContain('C:/shots/home.png');
    expect(String(tools[1]!['input'])).toContain('A robot in a pocket');
    expect(tools[1]!['output']).toBe('Saved to C:/out/robot.png');
    expect(JSON.stringify(tools)).not.toContain('BASE64PIXELS');
  });

  it('pictures go in as images; other files are named for Codex to open', () => {
    const file = (name: string, mime: string) =>
      ({ path: `C:\\files\\${name}`, ref: { mime }, data: Buffer.from('x') }) as never;
    const input = codexInput('look', [file('a.png', 'image/png'), file('b.pdf', 'application/pdf')]);
    expect(input[0]).toEqual({ type: 'localImage', path: 'C:\\files\\a.png' });
    expect(String(input[1]!['text'])).toContain('C:\\files\\b.pdf');
    expect(String(input[1]!['text'])).not.toContain('a.png');
  });
});

describe('Codex approvals from the phone', () => {
  async function running(opts: { remote?: boolean; waitMs?: number }) {
    const h = harness(opts);
    await h.codex.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.emit({ method: 'turn/started', params: { threadId: 'th-1', turn: { id: 'tu-1' } } });
    const ask = (id: number, method: string, params: Json) =>
      h.server.emit({ id, method, params: { threadId: 'th-1', turnId: 'tu-1', ...params } });
    return { ...h, ask };
  }

  it('a chat offers remote approval only when the PC owner turned it on', async () => {
    expect((await running({ remote: true })).registry.get('th-1')?.capabilities.remoteApproval).toBe(true);
    expect((await running({ remote: false })).registry.get('th-1')?.capabilities.remoteApproval).toBe(false);
  });

  it('a command beyond the sandbox waits for the phone; Allow for this chat answers acceptForSession', async () => {
    const h = await running({ remote: true });
    h.ask(7, 'item/commandExecution/requestApproval', {
      itemId: 'i5',
      command: 'npm install',
      reason: 'Needs the network',
      networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' },
    });
    await h.tick();
    const [req] = h.of('agent.permission.requested');
    expect(req).toMatchObject({
      requestId: 'th-1:i5',
      toolUseId: 'i5',
      toolName: 'Bash',
      awaitingRemote: true,
      remember: 'This command, for the rest of this chat',
    });
    expect(JSON.parse(String(req!['input']))).toEqual({
      command: 'npm install',
      description: 'Needs the network · Network access to registry.npmjs.org',
    });
    expect(h.registry.get('th-1')?.status).toBe('WaitingForPermission');
    expect(h.server.answers).toHaveLength(0); // nothing answered before the phone decides

    expect(h.broker.decide('th-1:i5', { behavior: 'allow', remember: true })).toBe(true);
    await h.tick();
    expect(h.server.answers).toContainEqual({ id: 7, result: { decision: 'acceptForSession' } });
    expect(h.of('agent.permission.resolved')).toEqual([{ requestId: 'th-1:i5', outcome: 'remote' }]);
    expect(h.registry.get('th-1')?.status).toBe('Running');
  });

  it('a file change names its files; Deny declines it', async () => {
    const h = await running({ remote: true });
    h.server.emit({
      method: 'item/started',
      params: {
        threadId: 'th-1',
        item: {
          type: 'fileChange',
          id: 'i6',
          status: 'inProgress',
          changes: [
            { path: 'C:/other/a.txt', kind: { type: 'update' }, diff: 'SECRET' },
            { path: 'C:/other/b.txt', kind: { type: 'add' }, diff: 'SECRET' },
          ],
        },
      },
    });
    h.ask(8, 'item/fileChange/requestApproval', { itemId: 'i6', reason: 'Outside the project' });
    await h.tick();
    const req = h.of('agent.permission.requested')[0]!;
    expect(req['toolName']).toBe('Edit');
    expect(JSON.parse(String(req['input']))).toEqual({
      file_path: 'C:/other/a.txt',
      description: 'Outside the project · And 1 more file',
    });
    expect(JSON.stringify(h.of('agent.permission.requested'))).not.toContain('SECRET');
    h.broker.decide('th-1:i6', { behavior: 'deny', message: 'no' });
    await h.tick();
    expect(h.server.answers).toContainEqual({ id: 8, result: { decision: 'decline' } });
  });

  it('more permissions: Allow grants exactly what was asked (this turn), Deny grants nothing', async () => {
    const h = await running({ remote: true });
    const permissions = { network: { enabled: true }, fileSystem: { read: null, write: ['C:/data'] } };
    h.ask(9, 'item/permissions/requestApproval', { itemId: 'i7', reason: 'Fetch and save', permissions });
    h.ask(10, 'item/permissions/requestApproval', { itemId: 'i8', reason: null, permissions });
    await h.tick();
    expect(h.of('agent.permission.requested')[0]!['toolName']).toBe('Sandbox');
    expect(JSON.parse(String(h.of('agent.permission.requested')[0]!['input']))).toEqual({
      description: 'Fetch and save',
      network: 'Internet access',
      write: ['C:/data'],
    });
    h.broker.decide('th-1:i7', { behavior: 'allow' });
    h.broker.decide('th-1:i8', { behavior: 'deny', message: 'no' });
    await h.tick();
    expect(h.server.answers).toContainEqual({ id: 9, result: { permissions, scope: 'turn' } });
    expect(h.server.answers).toContainEqual({ id: 10, result: { permissions: {}, scope: 'turn' } });
  });

  it('nobody decides in time: declined, with a word in the chat', async () => {
    const h = await running({ remote: true, waitMs: 20 });
    h.ask(11, 'item/commandExecution/requestApproval', { itemId: 'i9', command: 'rm -rf build' });
    await new Promise((r) => setTimeout(r, 60));
    expect(h.server.answers).toContainEqual({ id: 11, result: { decision: 'decline' } });
    expect(h.of('agent.permission.resolved')).toEqual([{ requestId: 'th-1:i9', outcome: 'timeout' }]);
    expect(JSON.stringify(h.of('agent.output'))).toContain('Nobody decided in time');
    // Too late: the phone's decision is not applied.
    expect(h.broker.decide('th-1:i9', { behavior: 'allow' })).toBe(false);
  });

  it('stopping the turn while it waits declines the request (cancelled)', async () => {
    const h = await running({ remote: true });
    h.ask(12, 'item/commandExecution/requestApproval', { itemId: 'i10', command: 'deploy' });
    await h.tick();
    await h.codex.interrupt('th-1');
    await h.tick();
    expect(h.server.answers).toContainEqual({ id: 12, result: { decision: 'decline' } });
    expect(h.of('agent.permission.resolved')).toEqual([{ requestId: 'th-1:i10', outcome: 'cancelled' }]);
  });

  it('remote approval off: declined at once, never sent to the phone', async () => {
    const h = await running({ remote: false });
    h.ask(13, 'item/commandExecution/requestApproval', { itemId: 'i11', command: 'curl x' });
    await h.tick();
    expect(h.of('agent.permission.requested')[0]!['awaitingRemote']).toBeUndefined();
    expect(h.of('agent.permission.resolved')).toEqual([{ requestId: 'th-1:i11', outcome: 'auto_denied' }]);
    expect(h.server.answers).toContainEqual({ id: 13, result: { decision: 'decline' } });
    expect(JSON.stringify(h.of('agent.output'))).toContain('remote approval is turned off');
  });
});

describe('finding Codex on the PC', () => {
  it('reports version, sign-in, the account Codex names, and visible models', async () => {
    const signedIn = fakeAppServer({ signedIn: true });
    expect(await detectCodex(() => signedIn.transport, '2.5.0')).toEqual({
      provider: 'codex',
      version: '0.172.0',
      signedIn: true,
      models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol', description: 'Fast' }],
      account: { email: 'me@example.com', plan: 'ChatGPT Plus' },
    });
    const out = fakeAppServer({ signedIn: false });
    expect(await detectCodex(() => out.transport, '2.5.0')).toMatchObject({ signedIn: false, account: null });
  });

  it('names the account kind: ChatGPT with its plan, an API key, or nothing', () => {
    expect(codexAccount({ type: 'chatgpt', email: null, planType: 'unknown' })).toEqual({
      email: null,
      plan: 'ChatGPT',
    });
    expect(codexAccount({ type: 'apiKey' })).toEqual({ email: null, plan: 'API key' });
    expect(codexAccount({ type: 'gcp' })).toBeNull();
    expect(codexAccount(null)).toBeNull();
  });

  it('is null when Codex isn’t installed', async () => {
    const missing = () => {
      throw new Error('spawn codex ENOENT');
    };
    expect(await detectCodex(missing, '2.5.0')).toBeNull();
    expect(codexVersion('pocket-agent/0.172.0 (Windows)')).toBe('0.172.0');
  });
});
