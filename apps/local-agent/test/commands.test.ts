import { createEvent, type BackendToAgent } from '@pocket-agent/protocol';
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
  const full: Policy = {
    projects: [],
    observedInstructions: false,
    wakeIdle: false,
    shareAttachments: false,
    remoteApproval: false,
    ...policy,
  };
  const router = new CommandRouter({ registry, managed, observed, policy: () => full, ack: ack as never });
  const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  return { acks, registry, sdk, managed, observed, router, statuses, tick };
}

describe('PC policy', () => {
  it('defaults to phone approvals only, and a corrupt file allows nothing', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-policy-'));
    expect(await loadPolicy(home)).toEqual({
      projects: [],
      observedInstructions: false,
      wakeIdle: false,
      shareAttachments: false,
      remoteApproval: true,
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(home, 'policy.json'), '{"observedInstructions": "yes please"}');
    expect(await loadPolicy(home)).toMatchObject({ observedInstructions: false, remoteApproval: false });
    await writeFile(path.join(home, 'policy.json'), '{ not json');
    expect((await loadPolicy(home)).remoteApproval).toBe(false);
    // Turned off by the PC owner: stays off.
    await writeFile(path.join(home, 'policy.json'), '{"remoteApproval": false}');
    expect((await loadPolicy(home)).remoteApproval).toBe(false);
    await savePolicy(home, {
      projects: [{ name: 'api', path: 'C:\\Work\\API' }],
      observedInstructions: true,
      wakeIdle: false,
      shareAttachments: false,
      remoteApproval: false,
    });
    expect(await loadPolicy(home)).toMatchObject({ observedInstructions: true });
  });

  it('allows a project folder and everything inside it (case-insensitive on Windows), never a sibling', () => {
    const policy: Policy = {
      projects: [{ name: 'api', path: 'C:\\Work\\API' }],
      observedInstructions: false,
      wakeIdle: false,
      shareAttachments: false,
      remoteApproval: false,
    };
    expect(normalizeProjectPath('C:\\Work\\API\\', 'win32')).toBe(
      normalizeProjectPath('c:\\work\\api', 'win32'),
    );
    if (process.platform === 'win32') expect(isAllowedProject(policy, 'c:\\work\\api')).toBeTruthy();
    expect(isAllowedProject(policy, 'C:\\Work\\API\\..\\secrets')).toBeUndefined();
    expect(isAllowedProject(policy, 'C:\\Work\\API-other')).toBeUndefined();
    expect(isAllowedProject(policy, 'C:\\Work')).toBeUndefined();
    if (process.platform === 'win32') {
      // Inside the allowed folder: allowed, as itself (its own path and name).
      expect(isAllowedProject(policy, 'C:\\Work\\API\\packages\\core')).toEqual({
        name: 'core',
        path: 'C:\\Work\\API\\packages\\core',
      });
      expect(isAllowedProject(policy, 'c:\\work\\api\\src')).toBeTruthy();
    }
  });
});

describe('command router', () => {
  it('starts managed sessions only in allow-listed folders', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-allowed-'));
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

  it('refuses interrupt/stop for sessions it does not know', async () => {
    const h = harness();
    const c = cmd({ commandType: 'session.stop' }, 'someone-elses-session');
    await h.router.handle(c);
    expect(h.acks.at(-1)).toMatchObject({ status: 'Failed', extra: { error: 'session_not_found' } });
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

describe('continuing an ended session', () => {
  function resumeHarness(exists: boolean, attachments?: unknown) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-resume-'));
    const acks: Array<{ id: string; status: string; extra?: Record<string, unknown> }> = [];
    const ack = (id: string, status: string, extra?: Record<string, unknown>) =>
      acks.push({ id, status, ...(extra ? { extra } : {}) });
    const registry = new SessionRegistry(() => undefined);
    const sdk = fakeSdk();
    const options: Array<Record<string, unknown>> = [];
    const fn: QueryFn = (args) => {
      options.push(args.options as Record<string, unknown>);
      return sdk.fn(args);
    };
    const managed = new ManagedSessions(registry, fn, () => undefined, ack as never);
    const observed = new ObservedInstructions(registry, ack as never);
    const policy: Policy = {
      // Continuing needs no allowed folder: it runs where the conversation ran.
      projects: [],
      observedInstructions: false,
      wakeIdle: false,
      shareAttachments: false,
      remoteApproval: false,
    };
    const router = new CommandRouter({
      registry,
      managed,
      observed,
      policy: () => policy,
      ack: ack as never,
      findConversation: async () => (exists ? { cwd: dir } : null),
      ...(attachments ? { attachments: attachments as never } : {}),
    });
    const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
    return { dir, acks, registry, sdk, options, router, statuses };
  }
  const OLD = '0b9d7c2e-1111-4a4a-9b9b-123456789abc';

  it('reopens the same session id with its history and runs the new message', async () => {
    const h = resumeHarness(true);
    const c = cmd(
      { commandType: 'session.start', projectPath: h.dir, text: 'More updates', resume: true },
      OLD,
    );
    await h.router.handle(c);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.statuses(c.payload.commandId)).toContain('Executing');
    expect(h.acks.find((a) => a.status === 'Executing')?.extra).toEqual({ externalSessionId: OLD });
    expect(h.options[0]).toMatchObject({ resume: OLD, cwd: h.dir });
    expect(h.options[0]).not.toHaveProperty('sessionId');
    expect(h.registry.get(OLD)?.mode).toBe('managed');
    expect(h.registry.get(OLD)?.metadata).toMatchObject({ startSource: 'resume' });
    expect(h.sdk.turns).toEqual(['More updates']);
  });

  it('hands Claude the files sent with the message that continues it', async () => {
    const ref = {
      id: '0b9d7c2e-2222-4a4a-9b9b-123456789abc',
      name: 'notes.txt',
      mime: 'text/plain',
      size: 5,
    };
    const downloads: unknown[] = [];
    const h = resumeHarness(true, {
      download: async (commandId: string, refs: unknown[]) => {
        downloads.push([commandId, refs]);
        return [{ ref, path: '/tmp/notes.txt', data: Buffer.from('hello') }];
      },
    });
    const c = cmd(
      { commandType: 'session.start', projectPath: h.dir, text: 'Read this', resume: true, attachments: [ref] },
      OLD,
    );
    await h.router.handle(c);
    await new Promise((r) => setTimeout(r, 30));
    expect(downloads).toHaveLength(1);
    expect(h.statuses(c.payload.commandId)).toContain('Executing');
    expect(JSON.stringify(h.sdk.turns[0])).toContain('notes.txt');
    expect(JSON.stringify(h.sdk.turns[0])).toContain('hello');
  });

  it('refuses when the conversation is gone or the session is still running', async () => {
    const gone = resumeHarness(false);
    const c1 = cmd({ commandType: 'session.start', projectPath: gone.dir, text: 'x', resume: true }, OLD);
    await gone.router.handle(c1);
    expect(gone.acks.at(-1)).toMatchObject({ status: 'Failed', extra: { error: 'conversation_not_found' } });

    const busy = resumeHarness(true);
    busy.registry.announce(
      {
        externalSessionId: OLD,
        provider: 'claude-code',
        mode: 'observed',
        projectPath: busy.dir,
        status: 'Running',
        capabilities: {} as never,
      },
      'hooks',
    );
    const c2 = cmd({ commandType: 'session.start', projectPath: busy.dir, text: 'x', resume: true }, OLD);
    await busy.router.handle(c2);
    expect(busy.acks.at(-1)).toMatchObject({ status: 'Failed', extra: { error: 'session_running' } });
    expect(busy.options).toHaveLength(0);
  });
});

describe('findConversation', async () => {
  const { findConversation } = await import('../src/providers/claude-code/conversation.js');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  it('finds the transcript and the folder it ran in; null when gone or the folder is gone', async () => {
    const config = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-conv-'));
    const work = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-work-'));
    const id = '11111111-2222-4333-8444-555555555555';
    mkdirSync(path.join(config, 'projects', 'C--some-project'), { recursive: true });
    writeFileSync(
      path.join(config, 'projects', 'C--some-project', `${id}.jsonl`),
      [JSON.stringify({ type: 'summary' }), '{not json', JSON.stringify({ type: 'user', cwd: work })].join(
        String.fromCharCode(10),
      ),
    );
    expect(await findConversation(id, config)).toEqual({ cwd: work });
    expect(await findConversation('22222222-2222-4333-8444-555555555555', config)).toBeNull();
    expect(await findConversation('../escape', config)).toBeNull();
    writeFileSync(
      path.join(config, 'projects', 'C--some-project', `${id}.jsonl`),
      JSON.stringify({ type: 'user', cwd: path.join(work, 'deleted') }),
    );
    expect(await findConversation(id, config)).toBeNull();
  });
});
