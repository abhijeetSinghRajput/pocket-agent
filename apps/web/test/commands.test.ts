import type { CommandDto } from '@agentdock/protocol';
import { describe, expect, it } from 'vitest';
import { canInstruct } from '@/components/agents/remote-control';
import { capabilityRows } from '@/components/agents/capabilities';
import { commandError, commandTitle, isOpen } from '@/lib/commands';

const cmd = (over: Partial<CommandDto>): CommandDto => ({
  id: '1',
  deviceId: 'd',
  sessionId: 's',
  commandType: 'instruction',
  text: 'Run tests',
  projectPath: null,
  status: 'Pending',
  error: null,
  createdAt: new Date().toISOString(),
  deliveredAt: null,
  completedAt: null,
  expiresAt: new Date().toISOString(),
  ...over,
});

describe('command presentation', () => {
  it('explains failures in plain language', () => {
    expect(commandError(cmd({ status: 'Failed', error: 'device_offline' }))).toBe(
      'Your PC is offline. Nothing was sent.',
    );
    expect(commandError(cmd({ status: 'Expired' }))).toContain('never run');
    expect(commandError(cmd({ status: 'Completed' }))).toBeNull();
    expect(commandError(cmd({ status: 'Failed', error: 'something_new' }))).toBe('something_new');
  });
  it('titles and open states', () => {
    expect(commandTitle(cmd({ commandType: 'interrupt', text: null }))).toBe('Interrupt');
    expect(isOpen('Executing')).toBe(true);
    expect(isOpen('Expired')).toBe(false);
  });
});

const session = (mode: 'managed' | 'observed', caps: Partial<Record<string, boolean>>, metadata = {}) =>
  ({
    id: 's',
    deviceId: 'd',
    deviceName: 'PC',
    provider: 'claude-code',
    mode,
    externalSessionId: 'e',
    projectName: 'p',
    projectPath: 'C:\\p',
    status: 'Running',
    capabilities: {
      monitor: true,
      remoteApproval: false,
      instructAnytime: false,
      instructBetweenTurns: false,
      interrupt: false,
      ...caps,
    },
    metadata,
    currentTask: null,
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    endedAt: null,
  }) as never;

describe('capability honesty', () => {
  it('never offers instructions the session cannot receive', () => {
    expect(canInstruct(session('observed', { remoteApproval: true }))).toBe(false);
    expect(canInstruct(session('observed', { remoteApproval: true, instructBetweenTurns: true }))).toBe(true);
    expect(
      canInstruct({ ...(session('managed', { instructAnytime: true }) as object), endedAt: 'x' } as never),
    ).toBe(false);
  });

  it('recognises hook-connected sessions even when the PC enabled nothing (regression)', () => {
    const rows = capabilityRows(session('observed', {}, { hooks: 'connected' }));
    const find = (label: string) => rows.find((r) => r.label === label)!;
    expect(find('Live status').detail).toContain('tool calls');
    expect(find('Send instructions').detail).toContain('agentdock instructions enable');
    expect(find('Approve permissions remotely').detail).toContain('agentdock approvals enable');
  });

  it('explains why instructions are unavailable', () => {
    const off = capabilityRows(session('observed', { remoteApproval: true })).find(
      (r) => r.label === 'Send instructions',
    )!;
    expect(off).toMatchObject({ state: 'no' });
    expect(off.detail).toContain('agentdock instructions enable');
    const stale = capabilityRows(session('observed', {}, { hooks: 'not-connected' })).find(
      (r) => r.label === 'Send instructions',
    )!;
    expect(stale.detail).toContain('Restart it on the PC');
  });
});
