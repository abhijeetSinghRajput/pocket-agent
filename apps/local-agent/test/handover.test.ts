import { createEvent, type BackendToAgent } from '@pocket-agent/protocol';
import { mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRouter } from '../src/command-router.js';
import type { Policy } from '../src/policy.js';
import { ObservedInstructions } from '../src/providers/claude-code/instructions.js';
import type { ManagedSessions } from '../src/providers/claude-code/managed.js';
import type { ManagedRuntime } from '../src/providers/types.js';
import { Handover } from '../src/sessions/handover.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Exec = Extract<BackendToAgent, { eventType: 'command.execute' }>;
const future = () => new Date(Date.now() + 60_000).toISOString();
const cmd = (payload: Record<string, unknown>, sessionId?: string) =>
  createEvent(
    'command.execute',
    { commandId: crypto.randomUUID(), expiresAt: future(), ...payload },
    sessionId ? { sessionId } : {},
  ) as unknown as Exec;
const started = (id: string, mode: 'managed' | 'observed', provider = 'claude-code') =>
  createEvent(
    'agent.session.started',
    {
      externalSessionId: id,
      provider,
      mode,
      projectPath: 'C:/work/api',
      projectName: 'api',
      status: 'Running',
      capabilities: {},
    },
    { sessionId: id },
  );
const ended = (id: string) =>
  createEvent('agent.session.ended', { externalSessionId: id, reason: 'stopped' }, { sessionId: id });

describe('chats kept across a PC agent restart', () => {
  it('remembers the managed chats that run (ids, agents, folders only) and forgets ended ones', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'pa-handover-')), 'managed-chats.json');
    const h = new Handover(file);
    h.track(started('a', 'managed'));
    h.track(started('b', 'managed', 'codex'));
    h.track(started('o', 'observed'));
    h.track(ended('a'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      b: { provider: 'codex', projectPath: 'C:/work/api' },
    });

    // The agent stops: chats it ends while stopping are kept for the next run.
    h.freeze();
    h.track(ended('b'));
    const next = new Handover(file);
    expect(next.load()).toEqual([{ id: 'b', provider: 'codex', projectPath: 'C:/work/api' }]);
    expect(next.dormantChat('b')).toBeDefined();

    // A day later they are let go.
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    utimesSync(file, old, old);
    expect(new Handover(file).load()).toEqual([]);
  });

  it('the next message continues a chat the last run left behind; a stop ends it', async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'pa-handover-')), 'managed-chats.json');
    new Handover(file).track(started('s1', 'managed'));
    const handover = new Handover(file);
    handover.load();
    handover.track(started('s2', 'managed', 'codex'));
    const acks: Array<{ id: string; status: string; extra?: Record<string, unknown> }> = [];
    const ack = (id: string, status: string, extra?: Record<string, unknown>) =>
      acks.push({ id, status, ...(extra ? { extra } : {}) });
    const registry = new SessionRegistry(() => undefined);
    registry.announce(
      {
        externalSessionId: 's1',
        provider: 'claude-code',
        mode: 'managed',
        projectPath: 'C:/work/api',
        status: 'WaitingForInput',
        capabilities: {
          monitor: true,
          remoteApproval: false,
          instructAnytime: true,
          instructBetweenTurns: true,
          interrupt: true,
        },
      },
      'managed',
    );
    const starts: unknown[] = [];
    const managed = {
      start: async (input: unknown) => {
        starts.push(input);
        return 's1';
      },
      send: () => false,
    } as unknown as ManagedSessions;
    const policy: Policy = {
      projects: [],
      observedInstructions: true,
      shareAttachments: false,
      remoteApproval: false,
    };
    const router = new CommandRouter({
      registry,
      managed,
      observed: new ObservedInstructions(registry, ack as never),
      handover,
      others: { codex: {} as ManagedRuntime },
      policy: () => policy,
      ack: ack as never,
    });

    const msg = cmd({ commandType: 'instruction', text: 'and now the tests' }, 's1');
    await router.handle(msg);
    expect(starts).toEqual([
      {
        projectPath: 'C:/work/api',
        prompt: 'and now the tests',
        commandId: msg.payload.commandId,
        resumeSessionId: 's1',
      },
    ]);
    expect(acks.at(-1)).toMatchObject({ status: 'Executing', extra: { externalSessionId: 's1' } });
    expect(handover.dormantChat('s1')).toBeUndefined(); // continued: no longer waiting

    // Another left-behind chat is stopped from the phone: it ends here.
    new Handover(file); // (nothing to do with the running one)
    const h2 = new Handover(file);
    h2.load();
    const stop = cmd({ commandType: 'session.stop' }, 's1');
    const router2 = new CommandRouter({
      registry,
      managed,
      observed: new ObservedInstructions(registry, ack as never),
      handover: h2,
      policy: () => policy,
      ack: ack as never,
    });
    await router2.handle(stop);
    expect(acks.at(-1)).toMatchObject({ id: stop.payload.commandId, status: 'Completed' });
    expect(registry.get('s1')).toBeUndefined();
  });
});
