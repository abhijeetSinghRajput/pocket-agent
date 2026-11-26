import { pcHealth } from '@pocket-agent/core';
import { LATEST_AGENT_VERSION, pairingRequestId, type DeviceDto } from '@pocket-agent/protocol';
import { describe, expect, it } from 'vitest';

const pc = (over: Partial<DeviceDto>): DeviceDto => ({
  id: 'd',
  name: 'PC',
  platform: 'windows',
  agentVersion: LATEST_AGENT_VERSION,
  status: 'Online',
  lastHeartbeatAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  revokedAt: null,
  remoteApprovalEnabled: true,
  projects: [],
  observedInstructions: false,
  models: [],
  usage: null,
  awayMode: true,
  health: { hooks: true },
  agents: [],
  ...over,
});

describe('pcHealth', () => {
  it('all good on a set-up PC', () => {
    expect(pcHealth(pc({})).map((c) => c.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('says how to fix each problem', () => {
    const checks = pcHealth(
      pc({
        status: 'Offline',
        agentVersion: '0.1.10',
        health: { hooks: false },
        remoteApprovalEnabled: false,
      }),
    );
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by['online']).toMatchObject({ state: 'fail', command: 'pocket-agent start --background' });
    expect(by['version']).toMatchObject({ state: 'warn' });
    expect(by['version']!.link).toContain('/releases/latest');
    expect(by['link']).toMatchObject({ state: 'warn', command: 'pocket-agent connect' });
    expect(by['approvals']).toMatchObject({ state: 'info', command: 'pocket-agent approvals enable' });
  });

  it('a PC that does not report its link is not called broken', () => {
    expect(pcHealth(pc({ health: null })).find((c) => c.key === 'link')!.state).toBe('info');
  });
});

describe('pairingRequestId', () => {
  const id = '0b8a3c1e-5d2f-4a6b-9c7d-1e2f3a4b5c6d';
  it('reads the request from a scanned pairing link', () => {
    expect(pairingRequestId(`https://pocket-agent.vercel.app/pair/${id}`)).toBe(id);
    expect(pairingRequestId(` https://x.example/pair/${id.toUpperCase()}/ `)).toBe(id);
  });
  it('anything else is not a pairing code', () => {
    expect(pairingRequestId('hello')).toBeNull();
    expect(pairingRequestId(`https://x.example/chat/${id}`)).toBeNull();
    expect(pairingRequestId(`https://x.example/pair/${id}/extra`)).toBeNull();
  });
});
