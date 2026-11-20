import { createEvent, type BackendToAgent } from '@agentdock/protocol';
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRouter } from '../src/command-router.js';
import {
  isAllowedProject,
  loadPolicy,
  normalizeProjectPath,
  savePolicy,
  type Policy,
} from '../src/policy.js';
import { ObservedInstructions } from '../src/providers/claude-code/instructions.js';
import { ManagedSessions, type QueryFn } from '../src/providers/claude-code/managed.js';
import { SessionRegistry } from '../src/sessions/registry.js';

type Exec = Extract<BackendToAgent, { eventType: 'command.execute' }>;
const future = () => new Date(Date.now() + 60_000).toISOString();
const cmd = (payload: Record<string, unknown>, sessionId?: string) =>
  createEvent(
    'command.execute',
    { commandId: crypto.randomUUID(), expiresAt: future(), ...payload },
    sessionId ? { sessionId } : {},
  ) as unknown as Exec;

/**
 * A fake SDK query that behaves like Claude Code's turn loop: it reads one user message, emits a
 * result, reads the next… `interrupt()` ends the running turn with an error result.
 */
function fakeSdk() {
  const turns: string[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  let interrupted = false;
  const fn: QueryFn = (args) => {
    const gen = (async function* (): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init' } as SDKMessage;
      for await (const m of args.prompt as AsyncIterable<SDKUserMessage>) {
        turns.push(m.message.content as string);
        if (hold) await new Promise<void>((r) => (release = r));
        yield { type: 'result', subtype: interrupted ? 'error_during_execution' : 'success' } as SDKMessage;
        interrupted = false;
      }
    })();
    return Object.assign(gen, {
      interrupt: async () => {
        interrupted = true;
        release?.();
      },
    }) as unknown as Query;
  };
  return { fn, turns, holdTurns: (v: boolean) => (hold = v), finishTurn: () => release?.() };
}

function harness(policy: Partial<Policy> = {}) {
  const acks: Array<{ id: string; status: string; extra?: Record<string, unknown> }> = [];
  const ack = (id: string, status: string, extra?: Record<string, unknown>) =>
    acks.push({ id, status, ...(extra ? { extra } : {}) });
  const registry = new SessionRegistry(() => undefined);
  const sdk = fakeSdk();
  const managed = new ManagedSessions(registry, sdk.fn, () => undefined, ack as never);
  const observed = new ObservedInstructions(registry, ack as never);
  const full: Policy = { projects: [], observedInstructions: false, remoteApproval: false, ...policy };
  const router = new CommandRouter({ registry, managed, observed, policy: () => full, ack: ack as never });
  const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  return { acks, registry, sdk, managed, observed, router, statuses, tick };
}

describe('PC policy', () => {
  it('defaults to nothing allowed and survives a corrupt file', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'agentdock-policy-'));
    expect(await loadPolicy(home)).toEqual({
      projects: [],
      observedInstructions: false,
      remoteApproval: false,
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(home, 'policy.json'), '{"observedInstructions": "yes please"}');
    expect((await loadPolicy(home)).observedInstructions).toBe(false);
    await savePolicy(home, {
      projects: [{ name: 'api', path: 'C:\\Work\\API' }],
      observedInstructions: true,
      remoteApproval: false,
    });
    expect(await loadPolicy(home)).toMatchObject({ observedInstructions: true });
  });

  it('matches project folders exactly (case-insensitive on Windows), not by prefix', () => {
    const policy: Policy = {
      projects: [{ name: 'api', path: 'C:\\Work\\API' }],
      observedInstructions: false,
      remoteApproval: false,
    };
    expect(normalizeProjectPath('C:\\Work\\API\\', 'win32')).toBe(
      normalizeProjectPath('c:\\work\\api', 'win32'),
    );
    if (process.platform === 'win32') expect(isAllowedProject(policy, 'c:\\work\\api')).toBeTruthy();
    expect(isAllowedProject(policy, 'C:\\Work\\API\\..\\secrets')).toBeUndefined();
    expect(isAllowedProject(policy, 'C:\\Work\\API-other')).toBeUndefined();
    expect(isAllowedProject(policy, 'C:\\Work')).toBeUndefined();
  });
});

describe('command router', () => {
  it('starts managed sessions only in allow-listed folders', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agentdock-allowed-'));
    const h = harness({ projects: [{ name: 'p', path: dir }] });
    const bad = cmd({ commandType: 'session.start', projectPath: os.tmpdir(), text: 'hi' });
    await h.router.handle(bad);
    expect(h.statuses(bad.payload.commandId)).toEqual(['Delivered', 'Failed']);
    expect(h.acks.at(-1)!.extra).toEqual({ error: 'project_not_allowed' });

    const ok = cmd({ commandType: 'session.start', projectPath: dir, text: 'Set up' });
    await h.router.handle(ok);
    const executing = h.acks.find((a) => a.id === ok.payload.commandId && a.status === 'Executing')!;
    const sid = executing.extra!['externalSessionId'] as string;
    expect(h.managed.isManaged(sid)).toBe(true);
    await h.tick();
    expect(h.sdk.turns).toEqual(['Set up']);
    expect(h.statuses(ok.payload.commandId)).toEqual(['Delivered', 'Executing', 'Completed']);
  });

  it('executes each command id at most once and never runs expired commands', async () => {
    const h = harness();
    const dup = cmd({ commandType: 'interrupt' }, 'nope');
    await h.router.handle(dup);
    await h.router.handle(dup);
    expect(h.statuses(dup.payload.commandId)).toEqual(['Delivered', 'Failed']);
    const old = cmd({ commandType: 'interrupt', expiresAt: new Date(Date.now() - 1).toISOString() }, 'x');
    await h.router.handle(old);
    expect(h.statuses(old.payload.commandId)).toEqual(['Delivered', 'Expired']);
  });

  it('refuses instructions to observed sessions unless the PC owner enabled them', async () => {
    const h = harness({ observedInstructions: false });
    h.registry.announce(
      {
        externalSessionId: 'obs',
        provider: 'claude-code',
        mode: 'observed',
        projectPath: 'C:\\x',
        status: 'Running',
        capabilities: {
          monitor: true,
          remoteApproval: true,
          instructAnytime: false,
          instructBetweenTurns: true,
          interrupt: false,
        },
      },
      'hooks',
    );
    const c = cmd({ commandType: 'instruction', text: 'do it' }, 'obs');
    await h.router.handle(c);
    expect(h.acks.at(-1)).toMatchObject({
      status: 'Failed',
      extra: { error: 'instructions_disabled_on_pc' },
    });

    const h2 = harness({ observedInstructions: true });
    h2.registry.announce({ ...h.registry.get('obs')! }, 'discovery'); // seen without hooks
    await h2.router.handle(cmd({ commandType: 'instruction', text: 'x' }, 'obs'));
    expect(h2.acks.at(-1)).toMatchObject({ status: 'Failed', extra: { error: 'hooks_not_connected' } });
  });

  it('refuses interrupt/stop for sessions it does not manage', async () => {
    const h = harness();
    const c = cmd({ commandType: 'session.stop' }, 'someone-elses-session');
    await h.router.handle(c);
    expect(h.acks.at(-1)).toMatchObject({ status: 'Failed', extra: { error: 'not_a_managed_session' } });
  });
});

describe('managed sessions: one instruction per turn', () => {
  it('queues an instruction sent mid-turn and runs it after the current turn', async () => {
    const h = harness();
    h.sdk.holdTurns(true);
    const sid = await h.managed.start({ projectPath: os.tmpdir(), prompt: 'first' });
    await h.tick();
    const second = cmd({ commandType: 'instruction', text: 'second' }, sid);
    await h.router.handle(second);
    await h.tick();
    expect(h.sdk.turns).toEqual(['first']); // not folded into the running turn
    expect(h.statuses(second.payload.commandId)).toEqual(['Delivered', 'Accepted']);

    h.sdk.finishTurn();
    await h.tick();
    expect(h.sdk.turns).toEqual(['first', 'second']);
    expect(h.statuses(second.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Executing']);
    h.sdk.finishTurn();
    await h.tick();
    expect(h.statuses(second.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Executing', 'Completed']);
  });

  it('interrupt ends the running turn; the interrupted instruction is reported as such', async () => {
    const h = harness();
    h.sdk.holdTurns(true);
    const sid = await h.managed.start({ projectPath: os.tmpdir(), prompt: 'warm up' });
    await h.tick();
    h.sdk.finishTurn();
    await h.tick();
    const long = cmd({ commandType: 'instruction', text: 'long task' }, sid);
    await h.router.handle(long);
    await h.tick();
    const stop = cmd({ commandType: 'interrupt' }, sid);
    await h.router.handle(stop);
    await h.tick();
    expect(h.statuses(stop.payload.commandId)).toEqual(['Delivered', 'Completed']);
    expect(h.acks.filter((a) => a.id === long.payload.commandId).at(-1)).toMatchObject({
      status: 'Failed',
      extra: { error: 'interrupted' },
    });
    expect(h.managed.isManaged(sid)).toBe(true); // session stays open
  });

  it('stop ends the session and fails anything still queued', async () => {
    const h = harness();
    h.sdk.holdTurns(true);
    const sid = await h.managed.start({ projectPath: os.tmpdir(), prompt: 'busy' });
    await h.tick();
    const queued = cmd({ commandType: 'instruction', text: 'later' }, sid);
    await h.router.handle(queued);
    await h.router.handle(cmd({ commandType: 'session.stop' }, sid));
    h.sdk.finishTurn();
    await h.tick();
    await h.tick();
    expect(h.managed.isManaged(sid)).toBe(false);
    expect(h.statuses(queued.payload.commandId).at(-1)).toBe('Failed');
  });
});
