import { createEvent, type BackendToAgent } from '@pocket-agent/protocol';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { CommandRouter } from '../src/command-router.js';
import type { Policy } from '../src/policy.js';
import { ClaudeHookHandler, observedCapabilities } from '../src/providers/claude-code/hooks.js';
import { ObservedInstructions } from '../src/providers/claude-code/instructions.js';
import { ManagedSessions, type QueryFn } from '../src/providers/claude-code/managed.js';
import { IdleWake } from '../src/providers/claude-code/wake.js';
import { SessionRegistry, type SessionEventOut } from '../src/sessions/registry.js';

type Exec = Extract<BackendToAgent, { eventType: 'command.execute' }>;
const instruction = (text: string, sessionId = 'obs') =>
  createEvent(
    'command.execute',
    {
      commandId: crypto.randomUUID(),
      commandType: 'instruction',
      text,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    { sessionId },
  ) as unknown as Exec;

/** Fake SDK: answers each resumed turn with a text reply, optionally held until released. */
function fakeSdk() {
  const calls: Array<{ prompt: string; options: Options }> = [];
  const releases: Array<() => void> = [];
  let hold = false;
  const fn: QueryFn = (args) =>
    (async function* (): AsyncGenerator<SDKMessage> {
      for await (const m of args.prompt as AsyncIterable<SDKUserMessage>) {
        calls.push({ prompt: m.message.content as string, options: args.options });
        if (hold) await new Promise<void>((r) => releases.push(r));
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: `Did: ${m.message.content as string}` }] },
        } as SDKMessage;
        yield { type: 'result', subtype: 'success' } as SDKMessage;
      }
    })() as unknown as Query;
  return { fn, calls, holdTurns: (v: boolean) => (hold = v), release: () => releases.shift()?.() };
}

function setup(policy: Partial<Policy> = {}) {
  const events: SessionEventOut[] = [];
  const acks: Array<{ id: string; status: string; extra?: Record<string, unknown> }> = [];
  const ack = (id: string, status: string, extra?: Record<string, unknown>) =>
    acks.push({ id, status, ...(extra ? { extra } : {}) });
  const registry = new SessionRegistry((e) => events.push(e));
  const sdk = fakeSdk();
  const managed = new ManagedSessions(registry, sdk.fn, () => undefined, ack as never);
  const observed = new ObservedInstructions(registry, ack as never);
  const wake = new IdleWake(registry, sdk.fn, ack as never);
  const full: Policy = {
    projects: [],
    observedInstructions: true,
    wakeIdle: true,
    remoteApproval: false,
    ...policy,
  };
  const router = new CommandRouter({
    registry,
    managed,
    observed,
    wake,
    policy: () => full,
    ack: ack as never,
  });
  const hooks = new ClaudeHookHandler(registry, managed.isManaged, {
    instructions: observed,
    instructionsAllowed: () => full.observedInstructions,
    wakeIdleAllowed: () => full.observedInstructions && full.wakeIdle,
    wake,
  });
  // A VS Code session with hooks, idle.
  hooks.handle({
    session_id: 'obs',
    hook_event_name: 'SessionStart',
    cwd: 'C:\\work\\app',
    source: 'startup',
  });
  const statuses = (id: string) => acks.filter((a) => a.id === id).map((a) => a.status);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const outputs = () =>
    events
      .filter((e) => e.eventType === 'agent.output')
      .map((e) => (e.payload as { role: string; text: string }).text);
  return { registry, sdk, router, hooks, wake, observed, acks, statuses, tick, outputs };
}

describe('waking an idle session from Pocket Agent', () => {
  it('runs the instruction at once by resuming the same session, and reports the turn', async () => {
    const h = setup();
    expect(h.registry.get('obs')!.status).toBe('WaitingForInput');
    const c = instruction('Update the changelog');
    await h.router.handle(c);
    await h.tick();
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.sdk.calls[0]!.options).toMatchObject({
      resume: 'obs',
      cwd: 'C:\\work\\app',
      permissionMode: 'default',
    });
    expect(h.sdk.calls[0]!.options.env?.['POCKET_AGENT_MANAGED_SESSION']).toBe('1'); // hooks don't double-report
    expect(h.statuses(c.payload.commandId)).toEqual(['Delivered', 'Executing', 'Completed']);
    expect(h.outputs()).toEqual(['Update the changelog', 'Did: Update the changelog']);
    expect(h.registry.get('obs')!.status).toBe('WaitingForInput');
  });

  it('runs instructions one after another while a woken turn is busy', async () => {
    const h = setup();
    h.sdk.holdTurns(true);
    const a = instruction('first');
    const b = instruction('second');
    await h.router.handle(a);
    await h.tick();
    await h.router.handle(b); // arrives mid-turn: joins the wake queue, not the Stop-hook queue
    expect(h.statuses(b.payload.commandId)).toEqual(['Delivered', 'Accepted']);
    expect(h.observed.pending('obs')).toBe(0);
    h.sdk.release();
    await h.tick();
    h.sdk.release();
    await h.tick();
    expect(h.sdk.calls.map((c) => c.prompt)).toEqual(['first', 'second']);
    expect(h.statuses(b.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Executing', 'Completed']);
  });

  it('holds back a prompt typed on the PC during a woken turn, then catches the editor up', async () => {
    const h = setup();
    h.sdk.holdTurns(true);
    await h.router.handle(instruction('Fix the build'));
    await h.tick();
    const blocked = h.hooks.handle({
      session_id: 'obs',
      hook_event_name: 'UserPromptSubmit',
      cwd: 'C:\\work\\app',
      prompt: 'hi',
    });
    expect(blocked).toMatchObject({ decision: 'block' });
    h.sdk.release();
    await h.tick();

    const out = h.hooks.handle({
      session_id: 'obs',
      hook_event_name: 'UserPromptSubmit',
      cwd: 'C:\\work\\app',
      prompt: 'next',
    }) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput.additionalContext).toContain('The user asked: Fix the build');
    expect(out.hookSpecificOutput.additionalContext).toContain('You replied: Did: Fix the build');
    // Given once only.
    expect(
      h.hooks.handle({
        session_id: 'obs',
        hook_event_name: 'UserPromptSubmit',
        cwd: 'C:\\work\\app',
        prompt: 'again',
      }),
    ).toBeUndefined();
  });

  it('without the wake opt-in, an idle session still waits for the next turn on the PC', async () => {
    const h = setup({ wakeIdle: false });
    const c = instruction('later');
    await h.router.handle(c);
    await h.tick();
    expect(h.sdk.calls).toHaveLength(0);
    expect(h.observed.pending('obs')).toBe(1);
    expect(h.statuses(c.payload.commandId)).toEqual(['Delivered', 'Accepted']);
  });

  it('a busy session is never woken: the instruction waits for the end of its turn', async () => {
    const h = setup();
    h.hooks.handle({
      session_id: 'obs',
      hook_event_name: 'UserPromptSubmit',
      cwd: 'C:\\work\\app',
      prompt: 'work',
    });
    await h.router.handle(instruction('after that'));
    await h.tick();
    expect(h.sdk.calls).toHaveLength(0);
    expect(h.observed.pending('obs')).toBe(1);
  });

  it('advertises "instruct any time" only with both opt-ins', () => {
    expect(observedCapabilities(true, false, true).instructAnytime).toBe(true);
    expect(observedCapabilities(true, false, false).instructAnytime).toBe(false);
    expect(observedCapabilities(false, false, true).instructAnytime).toBe(false);
  });
});
