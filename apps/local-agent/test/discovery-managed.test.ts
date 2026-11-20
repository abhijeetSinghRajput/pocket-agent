import { AgentToBackend } from '@pocket-agent/protocol';
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeDiscovery, readSessionsDir } from '../src/providers/claude-code/discovery.js';
import { ManagedSessions, NO_APPROVAL_CHANNEL, type QueryFn } from '../src/providers/claude-code/managed.js';
import { SessionRegistry, type SessionEventOut } from '../src/sessions/registry.js';

function recorder() {
  const events: SessionEventOut[] = [];
  return { events, registry: new SessionRegistry((e) => events.push(e)) };
}

describe('discovery (~/.claude/sessions)', () => {
  function dir(files: Record<string, unknown>) {
    const d = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-sessions-'));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(d, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    return d;
  }

  it('reads only <pid>.json files and never the token files next to them', async () => {
    const d = dir({
      '100.json': {
        pid: 100,
        sessionId: 'a',
        cwd: 'C:\\work\\a',
        status: 'idle',
        entrypoint: 'claude-vscode',
      },
      '100.abcdef.key': { peerToken: 'SECRET' },
      'notes.json': { sessionId: 'x', cwd: 'y' },
      '101.json': '{ broken',
    });
    const found = await readSessionsDir(d);
    expect(found).toEqual([
      { pid: 100, sessionId: 'a', cwd: 'C:\\work\\a', status: 'idle', entrypoint: 'claude-vscode' },
    ]);
    expect(JSON.stringify(found)).not.toContain('SECRET');
  });

  it('announces live sessions honestly (monitor-only without hooks) and ends them when the process exits', async () => {
    const d = dir({
      '200.json': {
        pid: 200,
        sessionId: 'b',
        cwd: 'C:\\work\\b',
        status: 'busy',
        entrypoint: 'claude-vscode',
      },
    });
    const { events, registry } = recorder();
    let alive = true;
    const disc = new ClaudeDiscovery(d, registry, {
      isManaged: () => false,
      hooksInstalled: () => false,
      alive: () => alive,
    });
    await disc.scan();
    expect(events[0]!.eventType).toBe('agent.session.started');
    expect(events[0]!.payload).toMatchObject({
      status: 'Running',
      capabilities: {
        monitor: true,
        remoteApproval: false,
        instructBetweenTurns: false,
        instructAnytime: false,
      },
      metadata: { entrypoint: 'claude-vscode', hooks: 'not-installed' },
    });

    writeFileSync(
      path.join(d, '200.json'),
      JSON.stringify({ pid: 200, sessionId: 'b', cwd: 'C:\\work\\b', status: 'idle' }),
    );
    await disc.scan();
    expect(events.at(-1)).toMatchObject({
      eventType: 'agent.session.updated',
      payload: { status: 'WaitingForInput' },
    });

    alive = false;
    await disc.scan();
    expect(events.at(-1)).toMatchObject({
      eventType: 'agent.session.ended',
      payload: { reason: 'process_exited' },
    });
    for (const e of events) expect(AgentToBackend.safeParse(e).success).toBe(true);
    rmSync(d, { recursive: true });
  });

  it('skips managed sessions', async () => {
    const d = dir({ '300.json': { pid: 300, sessionId: 'm', cwd: 'C:\\x' } });
    const { events, registry } = recorder();
    await new ClaudeDiscovery(d, registry, {
      isManaged: () => true,
      hooksInstalled: () => true,
      alive: () => true,
    }).scan();
    expect(events).toEqual([]);
  });
});

/** Minimal stand-in for the SDK's query(): replays scripted messages and exercises canUseTool. */
function fakeQuery(script: (opts: Parameters<QueryFn>[0]) => AsyncGenerator<SDKMessage>): {
  fn: QueryFn;
  seen: { prompts: string[]; options: Parameters<QueryFn>[0]['options'] | null };
} {
  const seen = { prompts: [] as string[], options: null as Parameters<QueryFn>[0]['options'] | null };
  const fn: QueryFn = (args) => {
    seen.options = args.options;
    const it = (async function* () {
      const reader = args.prompt[Symbol.asyncIterator]();
      const first = (await reader.next()).value as SDKUserMessage;
      seen.prompts.push(first.message.content as string);
      yield* script(args);
    })();
    return it as unknown as Query;
  };
  return { fn, seen };
}

const asMsg = (m: unknown) => m as SDKMessage;

describe('managed sessions (Agent SDK)', () => {
  it('maps the SDK stream to events and denies permission requests (never auto-allows)', async () => {
    const { events, registry } = recorder();
    let decision: unknown;
    const { fn, seen } = fakeQuery(async function* (args) {
      yield asMsg({ type: 'system', subtype: 'init', session_id: args.options.sessionId });
      yield asMsg({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Running the tests.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
      });
      decision = await args.options.canUseTool!('Bash', { command: 'npm test' }, {
        signal: new AbortController().signal,
        toolUseID: 'toolu_1',
      } as never);
      yield asMsg({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'denied' }],
        },
      });
      yield asMsg({ type: 'result', subtype: 'success' });
    });
    const managed = new ManagedSessions(registry, fn);
    const dirPath = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-proj-'));
    const id = await managed.start({ projectPath: dirPath, prompt: 'Fix the build' });
    expect(managed.isManaged(id)).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(seen.prompts).toEqual(['Fix the build']);
    expect(seen.options).toMatchObject({ cwd: dirPath, sessionId: id, permissionMode: 'default' });
    expect(seen.options!.env!['POCKET_AGENT_MANAGED_SESSION']).toBe('1');
    expect(decision).toEqual({ behavior: 'deny', message: NO_APPROVAL_CHANNEL });

    const types = events.map((e) => e.eventType);
    expect(types).toEqual([
      'agent.session.started',
      'agent.output',
      'agent.session.updated', // Running + task
      'agent.output', // assistant text
      'agent.tool.started',
      'agent.permission.requested',
      'agent.permission.resolved',
      'agent.tool.failed',
      'agent.session.updated', // WaitingForInput
      'agent.session.ended', // stream finished
    ]);
    expect(events[0]!.payload).toMatchObject({
      mode: 'managed',
      status: 'Starting',
      capabilities: { instructAnytime: true },
    });
    expect(events.find((e) => e.eventType === 'agent.permission.resolved')!.payload).toMatchObject({
      outcome: 'auto_denied',
    });
    for (const e of events) expect(AgentToBackend.safeParse(e).success, e.eventType).toBe(true);
  });

  it('refuses a project directory that does not exist', async () => {
    const { registry } = recorder();
    const managed = new ManagedSessions(registry, fakeQuery(async function* () {}).fn);
    await expect(
      managed.start({ projectPath: path.join(os.tmpdir(), 'nope-' + Date.now()), prompt: 'x' }),
    ).rejects.toThrow(/Not a directory/);
  });

  it('stop ends the session', async () => {
    const { events, registry } = recorder();
    const { fn } = fakeQuery(async function* (args) {
      yield asMsg({ type: 'system', subtype: 'init' });
      await new Promise((_, reject) =>
        args.options.abortController!.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });
    const managed = new ManagedSessions(registry, fn);
    const id = await managed.start({ projectPath: os.tmpdir(), prompt: 'long task' });
    await new Promise((r) => setTimeout(r, 20));
    expect(await managed.stop(id)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(events.at(-1)).toMatchObject({ eventType: 'agent.session.ended', payload: { reason: 'stopped' } });
    expect(managed.isManaged(id)).toBe(false);
  });
});
