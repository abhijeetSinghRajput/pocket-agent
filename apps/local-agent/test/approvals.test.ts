import { AgentToBackend } from '@agentdock/protocol';
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { ApprovalBroker } from '../src/approvals.js';
import { ClaudeHookHandler } from '../src/providers/claude-code/hooks.js';
import {
  ManagedSessions,
  NO_APPROVAL_CHANNEL,
  NO_DECISION_IN_TIME,
  type QueryFn,
} from '../src/providers/claude-code/managed.js';
import { SessionRegistry, type SessionEventOut } from '../src/sessions/registry.js';

type Payload = Record<string, unknown>;
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/claude-code-hooks.v2.1.325.json', import.meta.url), 'utf8'),
) as Payload[];
const hook = (name: string) => structuredClone(fixtures.find((f) => f['hook_event_name'] === name)!);

describe('ApprovalBroker', () => {
  it('resolves each request exactly once', async () => {
    const b = new ApprovalBroker();
    const p = b.wait('r1', 10_000);
    expect(b.decide('r1', { behavior: 'allow' })).toBe(true);
    expect(await p).toEqual({ behavior: 'allow' });
    expect(b.decide('r1', { behavior: 'allow' })).toBe(false); // too late → "stale"
  });
  it('times out and cancels to null (never an approval)', async () => {
    const b = new ApprovalBroker();
    expect(await b.wait('t', 10)).toBeNull();
    const c = b.wait('c', 10_000);
    b.cancel('c');
    expect(await c).toBeNull();
  });
});

function observed(opts: { away: boolean; waitMs?: number }) {
  const events: SessionEventOut[] = [];
  const registry = new SessionRegistry((e) => events.push(e));
  const broker = new ApprovalBroker();
  const handler = new ClaudeHookHandler(registry, () => false, {
    approvals: broker,
    remoteApprovalAllowed: () => true,
    holdForRemote: () => opts.away,
    approvalWaitMs: opts.waitMs ?? 10_000,
  });
  handler.handle(hook('SessionStart'));
  handler.handle(hook('PreToolUse'));
  const requestId = hook('PreToolUse')['tool_use_id'] as string;
  return { events, broker, handler, requestId };
}
const outcomes = (events: SessionEventOut[]) =>
  events
    .filter((e) => e.eventType === 'agent.permission.resolved')
    .map((e) => (e.payload as { outcome: string }).outcome);

describe('sessions the user started: PermissionRequest', () => {
  it('is never held when the user is not away (Claude Code asks on the PC as usual)', () => {
    const t = observed({ away: false });
    expect(t.handler.handle(hook('PermissionRequest'))).toBeUndefined();
    const req = t.events.find((e) => e.eventType === 'agent.permission.requested')!;
    expect((req.payload as { awaitingRemote?: boolean }).awaitingRemote).toBeUndefined();
  });

  it('in Away mode, waits for the decision and answers with exactly allow (no modified input)', async () => {
    const t = observed({ away: true });
    const pending = t.handler.handle(hook('PermissionRequest')) as Promise<unknown>;
    const req = t.events.find((e) => e.eventType === 'agent.permission.requested')!;
    expect(req.payload).toMatchObject({ requestId: t.requestId, awaitingRemote: true });
    expect(AgentToBackend.safeParse(req).success).toBe(true);
    t.broker.decide(t.requestId, { behavior: 'allow' });
    expect(await pending).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    expect(outcomes(t.events)).toEqual(['remote']);
  });

  it('passes a deny reason to Claude', async () => {
    const t = observed({ away: true });
    const pending = t.handler.handle(hook('PermissionRequest')) as Promise<unknown>;
    t.broker.decide(t.requestId, { behavior: 'deny', message: 'Not today' });
    expect(await pending).toMatchObject({
      hookSpecificOutput: { decision: { behavior: 'deny', message: 'Not today' } },
    });
  });

  it('answers nothing on timeout, so Claude Code falls back to asking on the PC', async () => {
    const t = observed({ away: true, waitMs: 20 });
    expect(await (t.handler.handle(hook('PermissionRequest')) as Promise<unknown>)).toBeUndefined();
    expect(outcomes(t.events)).toEqual(['timeout']);
  });

  it('stops waiting when the request is answered on the PC; a late decision is stale', async () => {
    const t = observed({ away: true });
    const pending = t.handler.handle(hook('PermissionRequest')) as Promise<unknown>;
    t.handler.handle(hook('PostToolUse')); // user clicked Allow on the PC
    expect(await pending).toBeUndefined();
    expect(outcomes(t.events)).toEqual(['local']);
    expect(t.broker.decide(t.requestId, { behavior: 'allow' })).toBe(false);
  });
});

/** Fake SDK: one turn that asks for one permission. */
function managedHarness(enabled: boolean, waitMs = 10_000) {
  const events: SessionEventOut[] = [];
  const registry = new SessionRegistry((e) => events.push(e));
  const broker = new ApprovalBroker();
  let decision: unknown;
  const input = { command: 'npm publish' };
  const fn: QueryFn = (args) =>
    (async function* (): AsyncGenerator<SDKMessage> {
      for await (const _m of args.prompt as AsyncIterable<SDKUserMessage>) {
        decision = await args.options.canUseTool!('Bash', input, {
          signal: new AbortController().signal,
          toolUseID: 'toolu_pub',
        } as never);
        yield { type: 'result', subtype: 'success' } as SDKMessage;
        return;
      }
    })() as unknown as Query;
  const managed = new ManagedSessions(
    registry,
    fn,
    () => undefined,
    () => undefined,
    Date.now,
    {
      broker,
      enabled: () => enabled,
      waitMs,
    },
  );
  return { events, broker, managed, input, decision: () => decision };
}

describe('managed sessions: canUseTool', () => {
  it('without the PC opt-in, denies (never allows)', async () => {
    const h = managedHarness(false);
    await h.managed.start({ projectPath: os.tmpdir(), prompt: 'publish' });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.decision()).toEqual({ behavior: 'deny', message: NO_APPROVAL_CHANNEL });
    expect(outcomes(h.events)).toEqual(['auto_denied']);
  });

  it('with the opt-in, waits for the remote decision and passes the input back unchanged', async () => {
    const h = managedHarness(true);
    await h.managed.start({ projectPath: os.tmpdir(), prompt: 'publish' });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.events.find((e) => e.eventType === 'agent.session.started')!.payload).toMatchObject({
      capabilities: { remoteApproval: true },
    });
    h.broker.decide('toolu_pub', { behavior: 'allow' });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.decision()).toEqual({ behavior: 'allow', updatedInput: h.input });
    expect((h.decision() as { updatedInput: unknown }).updatedInput).toBe(h.input); // same object, not modified
    expect(outcomes(h.events)).toEqual(['remote']);
  });

  it('denies when nobody decides in time', async () => {
    const h = managedHarness(true, 20);
    await h.managed.start({ projectPath: os.tmpdir(), prompt: 'publish' });
    await new Promise((r) => setTimeout(r, 80));
    expect(h.decision()).toEqual({ behavior: 'deny', message: NO_DECISION_IN_TIME });
    expect(outcomes(h.events)).toEqual(['timeout']);
  });
});
