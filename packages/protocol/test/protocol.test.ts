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
