import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexVersion, detectCodex } from '../src/providers/codex/detect.js';
import type { Transport } from '../src/providers/codex/rpc.js';
import { CodexSessions, codexInput } from '../src/providers/codex/sessions.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Json = Record<string, unknown>;

/**
 * A stand-in for `codex app-server`, speaking its JSON-RPC lines: answers requests, and lets the
 * test send notifications and requests like Codex would during a turn.
 */
function fakeAppServer(opts: { signedIn?: boolean } = {}) {
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
            : method === 'turn/start'
              ? { turn: { id: `tu-${++turn}` } }
              : method === 'account/read'
                ? { account: opts.signedIn ? { type: 'chatgpt' } : null }
                : method === 'model/list'
                  ? {
                      data: [
                        { id: 'gpt-6.2-sol', displayName: 'GPT-6.2-Sol', description: 'Fast', hidden: false },
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

function harness() {
  const project = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-codex-'));
  const events: Json[] = [];
  const registry = new SessionRegistry((e) => events.push(e as unknown as Json));
  const acks: Array<{ id: string; status: string; extra?: Json }> = [];
  const server = fakeAppServer();
  const codex = new CodexSessions(
    registry,
    () => server.transport,
    '2.5.0',
    () => undefined,
    ((id: string, status: string, extra?: Json) =>
      acks.push({ id, status, ...(extra ? { extra } : {}) })) as never,
  );
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const of = (type: string) => events.filter((e) => e['eventType'] === type).map((e) => e['payload'] as Json);
  const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
  return { project, registry, server, codex, tick, of, acks, statuses };
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

  it('pictures go in as images; other files are named for Codex to open', () => {
    const file = (name: string, mime: string) =>
      ({ path: `C:\\files\\${name}`, ref: { mime }, data: Buffer.from('x') }) as never;
    const input = codexInput('look', [file('a.png', 'image/png'), file('b.pdf', 'application/pdf')]);
    expect(input[0]).toEqual({ type: 'localImage', path: 'C:\\files\\a.png' });
    expect(String(input[1]!['text'])).toContain('C:\\files\\b.pdf');
    expect(String(input[1]!['text'])).not.toContain('a.png');
  });
});

describe('finding Codex on the PC', () => {
  it('reports version, sign-in and visible models (never the account)', async () => {
    const signedIn = fakeAppServer({ signedIn: true });
    expect(await detectCodex(() => signedIn.transport, '2.5.0')).toEqual({
      provider: 'codex',
      version: '0.172.0',
      signedIn: true,
      models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol', description: 'Fast' }],
    });
    const out = fakeAppServer({ signedIn: false });
    expect((await detectCodex(() => out.transport, '2.5.0'))?.signedIn).toBe(false);
  });

  it('is null when Codex isn’t installed', async () => {
    const missing = () => {
      throw new Error('spawn codex ENOENT');
    };
    expect(await detectCodex(missing, '2.5.0')).toBeNull();
    expect(codexVersion('pocket-agent/0.172.0 (Windows)')).toBe('0.172.0');
  });
});
