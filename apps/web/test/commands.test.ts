import type { CommandDto } from '@pocket-agent/protocol';
import { describe, expect, it } from 'vitest';
import {
  canConfigureLive,
  canInstruct,
  capabilityRows,
  commandError,
  commandTitle,
  isOpen,
  modelLock,
} from '@/lib/commands';

const cmd = (over: Partial<CommandDto>): CommandDto => ({
  id: '1',
  deviceId: 'd',
  sessionId: 's',
  commandType: 'instruction',
  text: 'Run tests',
  projectPath: null,
  attachments: [],
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
    expect(find('Send instructions').detail).toContain('pocket-agent instructions enable');
    expect(find('Approve permissions remotely').detail).toContain('pocket-agent approvals enable');
  });

  it('explains why instructions are unavailable', () => {
    const off = capabilityRows(session('observed', { remoteApproval: true })).find(
      (r) => r.label === 'Send instructions',
    )!;
    expect(off).toMatchObject({ state: 'no' });
    expect(off.detail).toContain('pocket-agent instructions enable');
    const stale = capabilityRows(session('observed', {}, { hooks: 'not-connected' })).find(
      (r) => r.label === 'Send instructions',
    )!;
    expect(stale.detail).toContain('Restart it on the PC');
  });
});

describe('switching mode and model mid-turn', () => {
  const device = { agentVersion: '2.4.0' } as never;
  it('an editor session the PC runs for the app switches at once, even while working', () => {
    const woken = session('observed', { instructAnytime: true }, { liveSettings: 'on' });
    expect(modelLock(woken)).toBeNull();
    expect(canConfigureLive(woken, device)).toBe(true);
  });
  it('a turn running in the editor keeps its settings, and says so once, plainly', () => {
    const editor = session('observed', { instructAnytime: true }, { liveSettings: 'off' });
    expect(modelLock(editor)).toContain('working in your editor');
    expect(canConfigureLive(editor, device)).toBe(false);
  });
});
