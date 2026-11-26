import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AntigravitySessions, describeTool } from '../src/providers/antigravity/sessions.js';
import type { Transport } from '../src/providers/codex/rpc.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Json = Record<string, unknown>;

/** A stand-in for `agy acp`: answers setup at once; a prompt answers when the test says. */
function fakeAcp() {
  const sent: Json[] = [];
  let lineListener: (line: string) => void = () => undefined;
  const emit = (msg: Json) => lineListener(JSON.stringify({ jsonrpc: '2.0', ...msg }));
  const prompts: Array<{ id: unknown; params: Json }> = [];
  const answers: Json[] = [];
  const transport: Transport = {
    write: (line) => {
      const msg = JSON.parse(line) as Json;
      sent.push(msg);
      const id = msg['id'];
      const method = msg['method'];
      if (method === undefined) return void answers.push(msg);
      if (id === undefined) return;
      if (method === 'session/prompt') return void prompts.push({ id, params: msg['params'] as Json });
      const result =
        method === 'session/new'
          ? { sessionId: 's-1', models: { currentModelId: 'gemini-4-hydrogen-high' } }
          : method === 'initialize'
            ? { protocolVersion: 1 }
            : {};
      queueMicrotask(() => emit({ id, result }));
    },
    onLine: (l) => void (lineListener = l),
    onClose: () => undefined,
    close: () => undefined,
  };
  const requests = (method: string) => sent.filter((m) => m['method'] === method);
  const update = (u: Json) => emit({ method: 'session/update', params: { sessionId: 's-1', update: u } });
  const finish = (stopReason = 'end_turn') => {
    const p = prompts.shift()!;
    emit({ id: p.id, result: { stopReason } });
  };
  return { transport, emit, sent, requests, update, finish, prompts, answers };
}

function harness() {
  const project = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-agy-'));
  const events: Json[] = [];
  const registry = new SessionRegistry((e) => events.push(e as unknown as Json));
  const acks: Array<{ id: string; status: string }> = [];
  const server = fakeAcp();
  const agy = new AntigravitySessions(
    registry,
    () => server.transport,
    '2.8.0',
    () => undefined,
    ((id: string, status: string) => acks.push({ id, status })) as never,
  );
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const of = (type: string) => events.filter((e) => e['eventType'] === type).map((e) => e['payload'] as Json);
  const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
  return { project, registry, server, agy, tick, of, statuses };
}

describe('Antigravity chats', () => {
  it('start a session in the project with the chosen model and mode, speaking JSON-RPC 2.0', async () => {
    const h = harness();
    const id = await h.agy.start({
      projectPath: h.project,
      prompt: 'fix the build',
      commandId: 'c1',
      model: 'gemini-3.8-flash-low',
      permissionMode: 'acceptEdits',
    });
    expect(id).toBe('s-1');
    expect(h.server.requests('session/new')[0]!['params']).toEqual({
      cwd: path.resolve(h.project),
      mcpServers: [],
    });
    await h.tick();
    expect(h.server.requests('session/set_model')[0]!['params']).toEqual({
      sessionId: 's-1',
      modelId: 'gemini-3.8-flash-low',
    });
    expect(h.server.requests('session/set_mode')[0]!['params']).toEqual({
      sessionId: 's-1',
      modeId: 'accept-edits',
    });
    expect(h.server.prompts[0]!.params).toEqual({
      sessionId: 's-1',
      prompt: [{ type: 'text', text: 'fix the build' }],
    });
    expect(h.server.sent.every((m) => m['jsonrpc'] === '2.0')).toBe(true);
    expect(h.registry.get('s-1')).toMatchObject({
      provider: 'antigravity',
      mode: 'managed',
      status: 'Running',
    });
  });

  it('says Antigravity’s reply as one message, with its commands and files in the app’s words', async () => {
    const h = harness();
    await h.agy.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Running ' } });
    h.server.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the tests.' } });
    h.server.update({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      name: 'run_command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { CommandLine: 'npm test' },
    });
    h.server.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      kind: 'execute',
      status: 'completed',
      rawOutput: '3 passed',
    });
    h.server.update({
      sessionUpdate: 'tool_call',
      toolCallId: 't2',
      name: 'write_file',
      kind: 'edit',
      status: 'completed',
      locations: [{ path: '/C:/work/a.ts' }],
      rawInput: { Content: 'SECRET BODY' },
    });
    h.server.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } });
    h.server.update({ sessionUpdate: 'session_info_update', title: 'Fix the build' });
    h.server.finish();
    await h.tick();
    expect(h.of('agent.output').map((o) => [o['role'], o['text']])).toEqual([
      ['user', 'go'],
      ['assistant', 'Running the tests.'],
      ['assistant', 'Done.'],
    ]);
    const done = h.of('agent.tool.completed');
    expect(done.map((d) => d['toolName'])).toEqual(['Bash', 'Write']);
    expect(String(done[0]!['output'])).toContain('3 passed');
    expect(String(done[1]!['input'])).toContain('C:/work/a.ts');
    expect(JSON.stringify(h.of('agent.tool.started'))).not.toContain('SECRET');
    expect(h.registry.get('s-1')).toMatchObject({
      status: 'WaitingForInput',
      metadata: { name: 'Fix the build' },
    });
    expect(h.statuses('c1')).toEqual(['Completed']);
  });

  it('runs queued messages one turn at a time; a new mode is sent only when it changes', async () => {
    const h = harness();
    await h.agy.start({ projectPath: h.project, prompt: 'first', commandId: 'c1', permissionMode: 'plan' });
    await h.tick();
    expect(
      h.agy.send('s-1', 'second', { commandId: 'c2', expiresAt: Infinity, permissionMode: 'plan' }),
    ).toBe(true);
    await h.tick();
    expect(h.server.prompts).toHaveLength(1);
    expect(h.statuses('c2')).toEqual(['Accepted']);
    h.server.finish();
    await h.tick();
    expect(h.server.prompts[0]!.params['prompt']).toEqual([{ type: 'text', text: 'second' }]);
    expect(h.server.requests('session/set_mode')).toHaveLength(1);
    expect(h.statuses('c2')).toEqual(['Accepted', 'Executing']);
  });

  it('stops a turn from the phone (session/cancel), and declines asking for permission (with a word in the chat)', async () => {
    const h = harness();
    await h.agy.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.server.emit({
      id: '7',
      method: 'session/request_permission',
      params: {
        sessionId: 's-1',
        toolCall: {
          toolCallId: 't9',
          name: 'run_command',
          kind: 'execute',
          rawInput: { CommandLine: 'dir' },
        },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
    });
    await h.tick();
    expect(h.server.answers).toContainEqual({
      jsonrpc: '2.0',
      id: '7',
      result: { outcome: { outcome: 'selected', optionId: 'deny' } },
    });
    expect(JSON.stringify(h.of('agent.output'))).toContain('declined');

    expect(await h.agy.interrupt('s-1')).toBe(true);
    expect(h.server.requests('session/cancel')[0]!['params']).toEqual({ sessionId: 's-1' });
    h.server.finish('cancelled');
    await h.tick();
    expect(h.registry.get('s-1')?.status).toBe('WaitingForInput');
    expect(h.statuses('c1')).toEqual(['Failed']);
  });

  it('a waiting message can be taken back; ending the chat fails what still waits', async () => {
    const h = harness();
    await h.agy.start({ projectPath: h.project, prompt: 'go', commandId: 'c1' });
    await h.tick();
    h.agy.send('s-1', 'later', { commandId: 'c2', expiresAt: Infinity });
    h.agy.send('s-1', 'even later', { commandId: 'c3', expiresAt: Infinity });
    expect(h.agy.withdraw('c2')).toBe(true);
    await h.agy.stop('s-1');
    expect(h.statuses('c2')).toEqual(['Accepted', 'Failed']);
    expect(h.statuses('c3')).toEqual(['Accepted', 'Failed']);
    expect(h.registry.get('s-1')).toBeUndefined();
  });

  it('names a tool by what it does, paths cleaned', () => {
    expect(describeTool({ kind: 'read', locations: [{ path: '/D:/x/y.md' }] })).toEqual({
      toolName: 'Read',
      input: JSON.stringify({ file_path: 'D:/x/y.md' }),
    });
    expect(describeTool({ kind: 'fetch', rawInput: { Url: 'https://example.com' } }).toolName).toBe(
      'WebFetch',
    );
  });
});
