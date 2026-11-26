import { createEvent, type BackendToAgent } from '@pocket-agent/protocol';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRouter } from '../src/command-router.js';
import type { Policy } from '../src/policy.js';
import { ObservedInstructions } from '../src/providers/claude-code/instructions.js';
import { ManagedSessions, type QueryFn } from '../src/providers/claude-code/managed.js';
import type { ManagedRuntime } from '../src/providers/types.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Exec = Extract<BackendToAgent, { eventType: 'command.execute' }>;
const future = () => new Date(Date.now() + 60_000).toISOString();
const cmd = (payload: Record<string, unknown>, sessionId?: string) =>
  createEvent(
    'command.execute',
    { commandId: crypto.randomUUID(), expiresAt: future(), ...payload },
    sessionId ? { sessionId } : {},
  ) as unknown as Exec;

/** A stand-in for another agent's runtime: records what the router asked of it. */
function fakeRuntime() {
  const calls: string[] = [];
  const running = new Set<string>();
  const runtime: ManagedRuntime = {
    isManaged: (id) => running.has(id),
    start: async (input) => {
      calls.push(`start:${input.prompt}:${input.model ?? ''}`);
      running.add('thread-1');
      return 'thread-1';
    },
    send: (id, text) => {
      calls.push(`send:${id}:${text}`);
      return running.has(id);
    },
    configure: async (id, change) => {
      calls.push(`configure:${id}:${change.model ?? change.permissionMode}`);
      return true;
    },
    interrupt: async (id) => {
      calls.push(`interrupt:${id}`);
      return true;
    },
    stop: async (id) => {
      calls.push(`stop:${id}`);
      running.delete(id);
      return true;
    },
    withdraw: () => false,
  };
  return { runtime, calls };
}

function harness(withCodex: boolean) {
  const project = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-providers-'));
  const acks: Array<{ id: string; status: string; extra?: Record<string, unknown> }> = [];
  const ack = (id: string, status: string, extra?: Record<string, unknown>) =>
    acks.push({ id, status, ...(extra ? { extra } : {}) });
  const registry = new SessionRegistry(() => undefined);
  // Claude must never be started for another agent's command.
  let claudeStarted = 0;
  const sdk: QueryFn = () => {
    claudeStarted++;
    return (async function* () {})() as unknown as Query;
  };
  const managed = new ManagedSessions(registry, sdk, () => undefined, ack as never);
  const observed = new ObservedInstructions(registry, ack as never);
  const policy: Policy = {
    projects: [{ name: 'p', path: project }],
    observedInstructions: true,
    shareAttachments: false,
    remoteApproval: false,
  };
  const codex = fakeRuntime();
  const router = new CommandRouter({
    registry,
    managed,
    observed,
    // Claude's model list: another agent's model isn't checked against it.
    models: () => [{ id: 'claude-opus-5-5' }],
    ...(withCodex ? { others: { codex: codex.runtime } } : {}),
    policy: () => policy,
    ack: ack as never,
  });
  const last = (id: string) => acks.filter((a) => a.id === id).at(-1);
  return { router, registry, codex, project, last, claudeStarted: () => claudeStarted };
}

describe('commands by coding agent', () => {
  it('refuses a chat with an agent this PC hasn’t got, and never starts Claude instead', async () => {
    const h = harness(false);
    const c = cmd({ commandType: 'session.start', provider: 'codex', projectPath: h.project, text: 'hi' });
    await h.router.handle(c);
    expect(h.last(c.payload.commandId)).toMatchObject({
      status: 'Failed',
      extra: { error: 'provider_not_available' },
    });
    expect(h.claudeStarted()).toBe(0);
  });

  it('starts a chat with the agent asked for, in an allowed folder, with its own model', async () => {
    const h = harness(true);
    const c = cmd({
      commandType: 'session.start',
      provider: 'codex',
      projectPath: h.project,
      text: 'fix the build',
      model: 'gpt-5.5-codex',
    });
    await h.router.handle(c);
    expect(h.last(c.payload.commandId)).toMatchObject({
      status: 'Executing',
      extra: { externalSessionId: 'thread-1' },
    });
    expect(h.codex.calls).toEqual(['start:fix the build:gpt-5.5-codex']);
    expect(h.claudeStarted()).toBe(0);
  });

  it('keeps the folder rule for every agent', async () => {
    const h = harness(true);
    const c = cmd({
      commandType: 'session.start',
      provider: 'codex',
      projectPath: 'C:\\elsewhere',
      text: 'hi',
    });
    await h.router.handle(c);
    expect(h.last(c.payload.commandId)).toMatchObject({
      status: 'Failed',
      extra: { error: 'project_not_allowed' },
    });
    expect(h.codex.calls).toEqual([]);
  });

  it('sends messages, settings and stops of an agent’s chat to that agent', async () => {
    const h = harness(true);
    await h.router.handle(
      cmd({ commandType: 'session.start', provider: 'codex', projectPath: h.project, text: 'hi' }),
    );
    // The PC reports the chat with its provider; later commands follow it there.
    h.registry.announce(
      {
        externalSessionId: 'thread-1',
        provider: 'codex',
        mode: 'managed',
        projectPath: h.project,
        status: 'WaitingForInput',
        capabilities: {
          monitor: true,
          remoteApproval: true,
          instructAnytime: true,
          instructBetweenTurns: true,
          interrupt: true,
        },
      },
      'managed',
    );
    await h.router.handle(cmd({ commandType: 'instruction', text: 'and test it' }, 'thread-1'));
    await h.router.handle(cmd({ commandType: 'session.configure', model: 'gpt-5.5' }, 'thread-1'));
    await h.router.handle(cmd({ commandType: 'interrupt' }, 'thread-1'));
    const stop = cmd({ commandType: 'session.stop' }, 'thread-1');
    await h.router.handle(stop);
    expect(h.codex.calls).toEqual([
      'start:hi:',
      'send:thread-1:and test it',
      'configure:thread-1:gpt-5.5',
      'interrupt:thread-1',
      'stop:thread-1',
    ]);
    expect(h.last(stop.payload.commandId)?.status).toBe('Completed');
    expect(h.claudeStarted()).toBe(0);
  });

  it('doesn’t continue an ended chat of another agent yet', async () => {
    const h = harness(true);
    const c = cmd(
      {
        commandType: 'session.start',
        provider: 'codex',
        resume: true,
        projectPath: h.project,
        text: 'go on',
      },
      'thread-9',
    );
    await h.router.handle(c);
    expect(h.last(c.payload.commandId)).toMatchObject({
      status: 'Failed',
      extra: { error: 'not_supported' },
    });
  });
});
