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
const instruction = (text: string, sessionId = 'obs', model?: string) =>
  createEvent(
    'command.execute',
    {
      commandId: crypto.randomUUID(),
      commandType: 'instruction',
      text,
      ...(model ? { model } : {}),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    { sessionId },
  ) as unknown as Exec;
const control = (commandType: 'interrupt' | 'session.stop', sessionId = 'obs') =>
  createEvent(
    'command.execute',
    { commandId: crypto.randomUUID(), commandType, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { sessionId },
  ) as unknown as Exec;

/** Fake SDK: answers each resumed turn with a text reply, optionally held until released. */
function fakeSdk() {
  const calls: Array<{ prompt: string; options: Options }> = [];
  const contexts: string[] = [];
  const releases: Array<() => void> = [];
  let hold = false;
  const fn: QueryFn = (args) =>
    (async function* (): AsyncGenerator<SDKMessage> {
      for await (const m of args.prompt as AsyncIterable<SDKUserMessage>) {
        // The first woken turn of a session starts with the app context; the user's text is last.
        const content = m.message.content as string | Array<{ type: string; text?: string }>;
        const text = typeof content === 'string' ? content : (content.at(-1)?.text ?? '');
        if (typeof content !== 'string') contexts.push(content[0]?.text ?? '');
        calls.push({ prompt: text, options: args.options });
        if (hold) await new Promise<void>((r) => releases.push(r));
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: `Did: ${text}` }] },
        } as SDKMessage;
        yield { type: 'result', subtype: 'success' } as SDKMessage;
      }
    })() as unknown as Query;
  return { fn, calls, contexts, holdTurns: (v: boolean) => (hold = v), release: () => releases.shift()?.() };
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
    shareAttachments: false,
    remoteApproval: false,
    ...policy,
  };
  const killed: number[] = [];
  const router = new CommandRouter({
    registry,
    managed,
    observed,
    wake,
    models: () => [{ id: 'opus' }, { id: 'haiku' }],
    kill: (pid) => void killed.push(pid),
    policy: () => full,
    ack: ack as never,
  });
  const hooks = new ClaudeHookHandler(registry, managed.isManaged, {
    instructions: observed,
    instructionsAllowed: () => full.observedInstructions,
    wakeIdleAllowed: () => full.observedInstructions,
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
  return { registry, sdk, router, hooks, wake, observed, acks, statuses, tick, outputs, killed };
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

  it('runs a woken turn with the mode and effort chosen in the app', async () => {
    const h = setup();
    const c = createEvent(
      'command.execute',
      {
        commandId: crypto.randomUUID(),
        commandType: 'instruction',
        text: 'plan it first',
        permissionMode: 'plan',
        effort: 'high',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { sessionId: 'obs' },
    ) as unknown as Exec;
    await h.router.handle(c);
    await h.tick();
    expect(h.sdk.calls[0]!.options).toMatchObject({ permissionMode: 'plan', effort: 'high' });
  });

  it('tells Claude once per session that the user is on the app, away from the PC', async () => {
    const h = setup();
    await h.router.handle(instruction('first'));
    await h.tick();
    await h.router.handle(instruction('second'));
    await h.tick();
    expect(h.sdk.calls.map((c) => c.prompt)).toEqual(['first', 'second']);
    expect(h.sdk.contexts).toHaveLength(1);
    expect(h.sdk.contexts[0]).toContain('Pocket Agent');
    expect(h.sdk.contexts[0]).toContain("can't see this PC");
    // The chat shows what the user wrote, never the context.
    expect(h.outputs().join(' ')).not.toContain('pocket-agent-context');
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

  it('an idle session is always woken when phone messages are on: there is no separate switch', async () => {
    const h = setup();
    const c = instruction('now please');
    await h.router.handle(c);
    await h.tick();
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.observed.pending('obs')).toBe(0);
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

  it('a busy session gets the message at its next tool step, in the same turn', async () => {
    const h = setup();
    const base = { session_id: 'obs', cwd: 'C:\\work\\app' };
    h.hooks.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'refactor it' });
    const a = instruction('Also add tests');
    const b = instruction('And update the README');
    await h.router.handle(a);
    await h.router.handle(b);
    expect(h.statuses(a.payload.commandId)).toEqual(['Delivered', 'Accepted']);

    // A subagent's tool call is not the conversation: nothing is delivered there.
    const sub = h.hooks.handle({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: 't0',
      tool_input: {},
      agent_id: 'agent-1',
    });
    expect(sub).toBeUndefined();

    const out = h.hooks.handle({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: { command: 'ls' },
    }) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput.additionalContext).toContain('1. Also add tests');
    expect(out.hookSpecificOutput.additionalContext).toContain('2. And update the README');
    expect(h.statuses(b.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Executing']);
    expect(h.outputs()).toEqual(['refactor it', 'Also add tests', 'And update the README']);
    expect(h.observed.pending('obs')).toBe(0);

    // Given once; the turn's end completes them and doesn't start another turn for them.
    expect(
      h.hooks.handle({
        ...base,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 't2',
        tool_input: { command: 'pwd' },
      }),
    ).toBeUndefined();
    expect(h.hooks.handle({ ...base, hook_event_name: 'Stop' })).toBeUndefined();
    expect(h.statuses(a.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Executing', 'Completed']);
    expect(h.statuses(b.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Executing', 'Completed']);
  });

  it('without the instructions opt-in, tool steps never carry anything', async () => {
    const h = setup({ observedInstructions: false });
    const base = { session_id: 'obs', cwd: 'C:\\work\\app' };
    h.hooks.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'work' });
    const c = instruction('sneak in');
    await h.router.handle(c);
    expect(h.statuses(c.payload.commandId)).toEqual(['Delivered', 'Failed']);
    expect(
      h.hooks.handle({
        ...base,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 't1',
        tool_input: {},
      }),
    ).toBeUndefined();
  });

  it('runs a woken turn with the chosen model, and refuses a model this PC does not offer', async () => {
    const h = setup();
    await h.router.handle(instruction('quick one', 'obs', 'haiku'));
    await h.tick();
    expect(h.sdk.calls[0]!.options.model).toBe('haiku');

    const bad = instruction('nope', 'obs', 'made-up-model');
    await h.router.handle(bad);
    await h.tick();
    expect(h.acks.filter((a) => a.id === bad.payload.commandId).at(-1)).toMatchObject({
      status: 'Failed',
      extra: { error: 'model_not_available' },
    });
    expect(h.sdk.calls).toHaveLength(1);
  });

  it('stops a working session at its next tool step', async () => {
    const h = setup();
    const base = { session_id: 'obs', cwd: 'C:\\work\\app' };
    h.hooks.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'long job' });
    const stop = control('interrupt');
    await h.router.handle(stop);
    expect(h.statuses(stop.payload.commandId)).toEqual(['Delivered', 'Accepted']);

    const out = h.hooks.handle({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 't1',
      tool_input: { command: 'rm -rf build' },
    });
    expect(out).toMatchObject({ continue: false });
    expect(h.statuses(stop.payload.commandId)).toEqual(['Delivered', 'Accepted', 'Completed']);
    expect(h.registry.get('obs')!.status).toBe('WaitingForInput');
    // Only once: the next turn runs normally.
    h.hooks.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'again' });
    expect(
      h.hooks.handle({
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_use_id: 't2',
        tool_input: {},
      }),
    ).toBeUndefined();
  });

  it('interrupting an idle session is a no-op; a woken turn stops at once', async () => {
    const h = setup();
    const idle = control('interrupt');
    await h.router.handle(idle);
    expect(h.statuses(idle.payload.commandId)).toEqual(['Delivered', 'Completed']);

    h.sdk.holdTurns(true);
    const c = instruction('long remote job');
    await h.router.handle(c);
    await h.tick();
    const stop = control('interrupt');
    await h.router.handle(stop);
    expect(h.statuses(stop.payload.commandId)).toEqual(['Delivered', 'Completed']);
    h.sdk.release();
    await h.tick();
    expect(h.acks.filter((a) => a.id === c.payload.commandId).at(-1)).toMatchObject({
      status: 'Failed',
      extra: { error: 'interrupted' },
    });
    expect(h.registry.get('obs')!.status).toBe('WaitingForInput');
  });

  it('ends a session the user started by closing its Claude Code process', async () => {
    const h = setup();
    const noPid = control('session.stop');
    await h.router.handle(noPid);
    expect(h.acks.at(-1)).toMatchObject({ status: 'Failed', extra: { error: 'process_not_found' } });

    const t = h.registry.get('obs')!;
    h.registry.announce({ ...t }, 'discovery', { pid: 4242 });
    const end = control('session.stop');
    await h.router.handle(end);
    expect(h.killed).toEqual([4242]);
    expect(h.statuses(end.payload.commandId)).toEqual(['Delivered', 'Completed']);
    expect(h.registry.get('obs')).toBeUndefined();
  });

  it('never stops or ends a session without the PC owner’s opt-in', async () => {
    const h = setup({ observedInstructions: false });
    const t = h.registry.get('obs')!;
    h.registry.announce({ ...t }, 'discovery', { pid: 4242 });
    for (const kind of ['interrupt', 'session.stop'] as const) {
      await h.router.handle(control(kind));
      expect(h.acks.at(-1)).toMatchObject({
        status: 'Failed',
        extra: { error: 'instructions_disabled_on_pc' },
      });
    }
    expect(h.killed).toEqual([]);
    expect(observedCapabilities(false).interrupt).toBe(false);
    expect(observedCapabilities(true).interrupt).toBe(true);
  });

  it('advertises "instruct any time" only with both opt-ins', () => {
    expect(observedCapabilities(true, false, true).instructAnytime).toBe(true);
    expect(observedCapabilities(true, false, false).instructAnytime).toBe(false);
    expect(observedCapabilities(false, false, true).instructAnytime).toBe(false);
  });
});
