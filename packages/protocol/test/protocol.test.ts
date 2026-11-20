import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TRANSITIONS,
  AgentToBackend,
  APPROVAL_TRANSITIONS,
  assertTransition,
  BackendToAgent,
  canTransition,
  CLAUDE_CODE_CAPABILITIES,
  COMMAND_TRANSITIONS,
  HealthResponse,
  InvalidTransitionError,
  isTerminal,
  MAX_TEXT_FIELD,
  PROTOCOL_VERSION,
  SESSION_SCOPED_EVENTS,
} from '../src/index.js';

const base = () => ({ v: PROTOCOL_VERSION, eventId: randomUUID(), timestamp: new Date().toISOString() });

describe('envelope parsing', () => {
  it('accepts a valid heartbeat', () => {
    const msg = {
      ...base(),
      deviceId: 'dev_1',
      eventType: 'device.heartbeat',
      payload: { activeSessions: 2 },
    };
    expect(AgentToBackend.parse(msg)).toEqual(msg);
  });

  it('rejects unknown event types', () => {
    const r = AgentToBackend.safeParse({ ...base(), eventType: 'device.selfdestruct', payload: {} });
    expect(r.success).toBe(false);
  });

  it('rejects unsupported protocol versions', () => {
    const r = AgentToBackend.safeParse({
      ...base(),
      v: 2,
      eventType: 'device.heartbeat',
      payload: { activeSessions: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid eventId (dedupe key must be well-formed)', () => {
    const r = AgentToBackend.safeParse({
      ...base(),
      eventId: '1',
      eventType: 'device.heartbeat',
      payload: { activeSessions: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects unexpected top-level fields (strict envelope)', () => {
    const r = AgentToBackend.safeParse({
      ...base(),
      eventType: 'device.heartbeat',
      payload: { activeSessions: 0 },
      admin: true,
    });
    expect(r.success).toBe(false);
  });

  it('enforces the text size limit on tool input', () => {
    const r = AgentToBackend.safeParse({
      ...base(),
      sessionId: 's1',
      eventType: 'agent.tool.started',
      payload: { toolUseId: 't1', toolName: 'Bash', input: 'x'.repeat(MAX_TEXT_FIELD + 1) },
    });
    expect(r.success).toBe(false);
  });

  it('parses an approval decision to the agent', () => {
    const msg = {
      ...base(),
      eventType: 'approval.decision',
      payload: { approvalId: randomUUID(), requestId: 'toolu_1', decision: 'deny', message: 'no' },
    };
    expect(BackendToAgent.parse(msg).eventType).toBe('approval.decision');
  });

  it('rejects approval decisions other than allow/deny', () => {
    const r = BackendToAgent.safeParse({
      ...base(),
      eventType: 'approval.decision',
      payload: { approvalId: randomUUID(), requestId: 'toolu_1', decision: 'always' },
    });
    expect(r.success).toBe(false);
  });
});

describe('session events (M3)', () => {
  it('accepts a snapshot and caps its size', () => {
    const ok = AgentToBackend.safeParse({
      ...base(),
      eventType: 'agent.sessions.snapshot',
      payload: { sessions: [{ externalSessionId: 's1', status: 'Running' }] },
    });
    expect(ok.success).toBe(true);
    const tooMany = AgentToBackend.safeParse({
      ...base(),
      eventType: 'agent.sessions.snapshot',
      payload: {
        sessions: Array.from({ length: 501 }, (_, i) => ({ externalSessionId: `s${i}`, status: 'Running' })),
      },
    });
    expect(tooMany.success).toBe(false);
  });

  it('records auto-denials but has no "auto-allow" outcome', () => {
    const resolved = (outcome: string) =>
      AgentToBackend.safeParse({
        ...base(),
        sessionId: 's1',
        eventType: 'agent.permission.resolved',
        payload: { requestId: 'r', outcome },
      }).success;
    expect(resolved('auto_denied')).toBe(true);
    expect(resolved('auto_allowed')).toBe(false);
  });

  it('marks session-scoped event types', () => {
    expect(SESSION_SCOPED_EVENTS.has('agent.tool.started')).toBe(true);
    expect(SESSION_SCOPED_EVENTS.has('device.heartbeat')).toBe(false);
    expect(SESSION_SCOPED_EVENTS.has('agent.sessions.snapshot')).toBe(false);
  });
});

describe('commands (M4)', () => {
  const exec = (payload: Record<string, unknown>) =>
    BackendToAgent.safeParse({
      ...base(),
      eventType: 'command.execute',
      payload: { commandId: randomUUID(), expiresAt: new Date().toISOString(), ...payload },
    }).success;

  it('accepts the four command types and requires an expiry', () => {
    expect(exec({ commandType: 'instruction', text: 'hi' })).toBe(true);
    expect(exec({ commandType: 'session.start', projectPath: 'C:\\p', text: 'hi' })).toBe(true);
    expect(exec({ commandType: 'interrupt' })).toBe(true);
    expect(exec({ commandType: 'session.stop' })).toBe(true);
    expect(exec({ commandType: 'shell', command: 'rm -rf /' })).toBe(false);
    expect(
      BackendToAgent.safeParse({
        ...base(),
        eventType: 'command.execute',
        payload: { commandId: randomUUID(), commandType: 'interrupt' },
      }).success,
    ).toBe(false);
  });

  it('caps instruction size', () => {
    expect(exec({ commandType: 'instruction', text: 'x'.repeat(20_001) })).toBe(false);
    expect(exec({ commandType: 'instruction', text: '' })).toBe(false);
  });

  it('validates device settings reported by the PC', () => {
    const settings = (payload: unknown) =>
      AgentToBackend.safeParse({ ...base(), eventType: 'device.settings', payload }).success;
    expect(
      settings({ projects: [{ name: 'api', path: 'C:\\work\\api' }], observedInstructions: false }),
    ).toBe(true);
    expect(
      settings({
        projects: Array.from({ length: 51 }, () => ({ name: 'p', path: 'C:\\p' })),
        observedInstructions: false,
      }),
    ).toBe(false);
    expect(settings({ projects: [] })).toBe(false);
  });
});

describe('state machines', () => {
  it('allows normal agent flow', () => {
    expect(canTransition(AGENT_TRANSITIONS, 'Running', 'WaitingForPermission')).toBe(true);
    expect(canTransition(AGENT_TRANSITIONS, 'WaitingForPermission', 'Running')).toBe(true);
  });

  it('treats Stopped as terminal', () => {
    expect(isTerminal(AGENT_TRANSITIONS, 'Stopped')).toBe(true);
    expect(() => assertTransition(AGENT_TRANSITIONS, 'Stopped', 'Running')).toThrow(InvalidTransitionError);
  });

  it('never lets a command move backwards', () => {
    expect(canTransition(COMMAND_TRANSITIONS, 'Executing', 'Pending')).toBe(false);
    expect(canTransition(COMMAND_TRANSITIONS, 'Completed', 'Failed')).toBe(false);
  });

  it('does not let an executing command expire (it must complete or fail)', () => {
    expect(canTransition(COMMAND_TRANSITIONS, 'Executing', 'Expired')).toBe(false);
  });

  it('decides an approval exactly once', () => {
    expect(canTransition(APPROVAL_TRANSITIONS, 'Pending', 'Approved')).toBe(true);
    for (const done of ['Approved', 'Denied', 'Expired', 'Cancelled'] as const) {
      expect(isTerminal(APPROVAL_TRANSITIONS, done)).toBe(true);
    }
    expect(canTransition(APPROVAL_TRANSITIONS, 'Expired', 'Approved')).toBe(false);
  });
});

describe('capabilities', () => {
  it('does not claim on-demand control of observed sessions', () => {
    expect(CLAUDE_CODE_CAPABILITIES.observed.instructAnytime).toBe(false);
    expect(CLAUDE_CODE_CAPABILITIES.observed.interrupt).toBe(false);
    expect(CLAUDE_CODE_CAPABILITIES.managed.instructAnytime).toBe(true);
  });
});

describe('health response', () => {
  it('validates a degraded response', () => {
    const r = HealthResponse.parse({
      status: 'degraded',
      service: 'agentdock-api',
      version: '0.1.0',
      uptimeSeconds: 3,
      checks: { database: { status: 'up', latencyMs: 2 }, redis: { status: 'down', error: 'ECONNREFUSED' } },
    });
    expect(r.checks.redis.status).toBe('down');
  });
});
