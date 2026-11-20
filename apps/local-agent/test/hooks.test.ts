// Contract test: real hook payloads recorded from Claude Code 2.1.325 (test/fixtures) must keep
// producing the expected events. If Claude Code changes its payloads, this is where it shows.
import { AgentToBackend } from '@pocket-agent/protocol';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClaudeHookHandler, MONITOR_ONLY } from '../src/providers/claude-code/hooks.js';
import { ObservedInstructions } from '../src/providers/claude-code/instructions.js';
import { SessionRegistry, type SessionEventOut } from '../src/sessions/registry.js';

type Payload = Record<string, unknown>;
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/claude-code-hooks.v2.1.325.json', import.meta.url), 'utf8'),
) as Payload[];
const byEvent = (name: string) => structuredClone(fixtures.find((f) => f['hook_event_name'] === name)!);

function setup(isManaged: (id: string) => boolean = () => false) {
  const events: SessionEventOut[] = [];
  const registry = new SessionRegistry((e) => events.push(e));
  return { events, registry, handler: new ClaudeHookHandler(registry, isManaged) };
}

describe('Claude Code hook payloads → protocol events', () => {
  it('turns the recorded session into a valid, ordered event stream', () => {
    const { events, handler } = setup();
    for (const p of fixtures) handler.handle(p);

    // Every emitted frame is on-contract.
    for (const e of events) expect(AgentToBackend.safeParse(e).success, JSON.stringify(e)).toBe(true);
    expect(events.map((e) => e.eventType)).toEqual([
      'agent.session.started',
      'agent.session.updated', // SessionStart → WaitingForInput
      'agent.output', // user prompt
      'agent.session.updated', // Running + currentTask
      'agent.tool.started',
      'agent.permission.requested',
      'agent.permission.resolved', // answered on the PC
      'agent.tool.completed',
      'agent.output', // last assistant message
      'agent.session.updated', // WaitingForInput
      'agent.session.ended',
    ]);
    const sid = fixtures[0]!['session_id'];
    expect(events.every((e) => e.sessionId === sid)).toBe(true);
    expect(events[0]!.payload).toMatchObject({
      mode: 'observed',
      projectName: 'demo-project',
      capabilities: { remoteApproval: false, instructAnytime: false, interrupt: false }, // approvals are PC opt-in
    });
  });

  it('correlates PermissionRequest (which has no tool_use_id) with its PreToolUse', () => {
    const { events, handler } = setup();
    for (const name of ['SessionStart', 'PreToolUse', 'PermissionRequest']) handler.handle(byEvent(name));
    const started = events.find((e) => e.eventType === 'agent.tool.started')!;
    const perm = events.find((e) => e.eventType === 'agent.permission.requested')!;
    expect(byEvent('PermissionRequest')['tool_use_id']).toBeUndefined();
    expect((perm.payload as { requestId: string }).requestId).toBe(
      (started.payload as { toolUseId: string }).toolUseId,
    );
  });

  it('forwards only allow-listed data (no file contents, no transcript paths)', () => {
    const { events, handler } = setup();
    handler.handle(byEvent('SessionStart'));
    handler.handle({
      ...byEvent('PreToolUse'),
      tool_name: 'Write',
      tool_use_id: 'toolu_w',
      tool_input: { file_path: 'C:\\work\\demo-project\\.env', content: 'API_KEY=super-secret-value' },
    });
    handler.handle({
      ...byEvent('PostToolUse'),
      tool_name: 'Read',
      tool_use_id: 'toolu_r',
      tool_input: { file_path: 'C:\\work\\demo-project\\notes.md' },
      tool_response: { file: { content: 'private notes' } },
    });
    handler.handle({
      ...byEvent('PreToolUse'),
      tool_name: 'mcp__db__query',
      tool_use_id: 'toolu_m',
      tool_input: { sql: 'select password from users' },
    });
    const wire = JSON.stringify(events);
    expect(wire).not.toContain('super-secret-value');
    expect(wire).not.toContain('private notes');
    expect(wire).not.toContain('select password');
    expect(wire).not.toContain('transcript');
    expect(wire).not.toContain('scratchpad');
    const inputs = events.map((e) => (e.payload as { input?: string }).input).filter(Boolean);
    expect(inputs).toContain(String.raw`{"file_path":"C:\\work\\demo-project\\.env","characters":26}`); // size only
    expect(inputs).toContain('{"arguments":["sql"]}'); // MCP: argument names only
  });

  it('ignores hooks of managed sessions (they report through the SDK)', () => {
    const { events, handler } = setup(() => true);
    for (const p of fixtures) handler.handle(p);
    expect(events).toEqual([]);
  });

  it('ignores malformed payloads', () => {
    const { events, handler } = setup();
    handler.handle({});
    handler.handle({ session_id: 1, hook_event_name: 'Stop', cwd: 'x' });
    handler.handle({ session_id: 's', hook_event_name: 'Stop' });
    expect(events).toEqual([]);
  });

  it('upgrades a discovery-only session once its hooks are seen', () => {
    const { events, registry, handler } = setup();
    const sid = fixtures[0]!['session_id'] as string;
    registry.announce(
      {
        externalSessionId: sid,
        provider: 'claude-code',
        mode: 'observed',
        projectPath: 'C:\\work\\demo-project',
        status: 'WaitingForInput',
        capabilities: MONITOR_ONLY,
        metadata: { entrypoint: 'claude-vscode' },
      },
      'discovery',
      { pid: 1234 },
    );
    handler.handle(byEvent('UserPromptSubmit'));
    const announcements = events.filter((e) => e.eventType === 'agent.session.started');
    expect(announcements).toHaveLength(2);
    expect(announcements[1]!.payload).toMatchObject({
      // Instructions are off until the PC owner enables them.
      capabilities: { remoteApproval: false, instructBetweenTurns: false },
      metadata: { entrypoint: 'claude-vscode', hooks: 'connected' },
    });
  });
});

describe('instructions to sessions the user started (Stop hook delivery)', () => {
  function withInstructions(allowed: boolean) {
    const events: SessionEventOut[] = [];
    const acks: Array<[string, string, object?]> = [];
    const registry = new SessionRegistry((e) => events.push(e));
    let now = 1_000;
    const instructions = new ObservedInstructions(
      registry,
      (id, status, extra) => acks.push([id, status, extra]),
      () => now,
    );
    let enabled = allowed;
    const handler = new ClaudeHookHandler(registry, () => false, {
      instructions,
      instructionsAllowed: () => enabled,
    });
    return {
      events,
      acks,
      instructions,
      handler,
      enable: (v: boolean) => (enabled = v),
      advance: (ms: number) => (now += ms),
    };
  }

  it('delivers a queued instruction at the next Stop, in the same session, and completes it at the following Stop', () => {
    const t = withInstructions(true);
    t.handler.handle(byEvent('SessionStart'));
    const sid = fixtures[0]!['session_id'] as string;
    t.instructions.enqueue(sid, { commandId: 'c1', text: 'Now add tests', expiresAt: 60_000 });

    expect(t.handler.handle(byEvent('PreToolUse'))).toBeUndefined(); // only Stop is ever answered
    const out = t.handler.handle(byEvent('Stop'));
    expect(out).toEqual({ decision: 'block', reason: expect.stringContaining('Now add tests') });
    expect(t.acks.map(([, s]) => s)).toEqual(['Accepted', 'Executing']);
    expect(t.events.at(-1)).toMatchObject({
      eventType: 'agent.session.updated',
      payload: { status: 'Running' },
    });

    expect(t.handler.handle(byEvent('Stop'))).toBeUndefined(); // queue empty
    expect(t.acks.at(-1)).toEqual(['c1', 'Completed', undefined]);
  });

  it('never answers Stop when the PC owner has not enabled instructions', () => {
    const t = withInstructions(false);
    t.handler.handle(byEvent('SessionStart'));
    t.instructions.enqueue(fixtures[0]!['session_id'] as string, {
      commandId: 'c1',
      text: 'x',
      expiresAt: 60_000,
    });
    expect(t.handler.handle(byEvent('Stop'))).toBeUndefined();
  });

  it('drops instructions that waited too long instead of delivering them late', () => {
    const t = withInstructions(true);
    t.handler.handle(byEvent('SessionStart'));
    t.instructions.enqueue(fixtures[0]!['session_id'] as string, {
      commandId: 'old',
      text: 'stale',
      expiresAt: 2_000,
    });
    t.advance(5_000);
    expect(t.handler.handle(byEvent('Stop'))).toBeUndefined();
    expect(t.acks.at(-1)).toEqual(['old', 'Expired', undefined]);
  });

  it('fails queued and in-flight instructions when the session ends', () => {
    const t = withInstructions(true);
    t.handler.handle(byEvent('SessionStart'));
    const sid = fixtures[0]!['session_id'] as string;
    t.instructions.enqueue(sid, { commandId: 'a', text: 'one', expiresAt: 60_000 });
    t.instructions.enqueue(sid, { commandId: 'b', text: 'two', expiresAt: 60_000 });
    t.handler.handle(byEvent('Stop')); // delivers "a"
    t.handler.handle(byEvent('SessionEnd'));
    expect(
      t.acks
        .filter(([, s]) => s === 'Failed')
        .map(([id]) => id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});
