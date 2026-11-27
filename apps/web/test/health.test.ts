import { pcAgents, pcHealth } from '@pocket-agent/core';
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
  claudeAccount: null,
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

  it('lists the other agents the PC found: ready, or how to sign in', () => {
    const checks = pcHealth(
      pc({
        agents: [
          { provider: 'codex', version: '0.172.0', signedIn: true, models: [] },
          { provider: 'antigravity', version: '1.5.12', signedIn: false, models: [] },
        ],
      }),
    );
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by['agent-codex']).toMatchObject({ label: 'Codex ready', state: 'ok' });
    expect(by['agent-antigravity']).toMatchObject({
      label: 'Antigravity CLI signed out',
      state: 'warn',
      command: 'agy',
    });
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

describe('pcAgents', () => {
  const model = { id: 'm', name: 'M', description: '' };
  const by = (d: DeviceDto) => Object.fromEntries(pcAgents(d).map((a) => [a.provider, a]));

  it('lists every agent, Claude first, with what fixes each one', () => {
    const agents = by(
      pc({
        usage: {
          session: null,
          weekly: null,
          models: [],
          plan: 'Max 5x',
          updatedAt: new Date().toISOString(),
        },
        models: [model, model],
        agents: [
          { provider: 'codex', version: '0.172.0', signedIn: true, models: [model] },
          { provider: 'cursor', version: '1.0.0', signedIn: false, models: [] },
        ],
      }),
    );
    expect(pcAgents(pc({}))[0]!.provider).toBe('claude-code');
    expect(Object.keys(agents)).toHaveLength(6);
    expect(agents['claude-code']).toMatchObject({ state: 'ready', detail: 'Claude Max 5x · 2 models' });
    expect(agents['codex']).toMatchObject({ state: 'ready', detail: 'Version 0.172.0 · 1 model' });
    expect(agents['cursor']).toMatchObject({ state: 'signed-out', command: 'agent login' });
    expect(agents['opencode']).toMatchObject({ state: 'missing' });
    expect(agents['opencode']!.command).toBe('pocket-agent doctor');
  });

  it('names the account each agent is signed in with, where the PC knows it', () => {
    const agents = by(
      pc({
        claudeAccount: { email: 'me@example.com', plan: null },
        agents: [
          {
            provider: 'codex',
            version: '1',
            signedIn: true,
            models: [],
            account: { email: 'me@example.com', plan: 'ChatGPT Plus' },
          },
          {
            provider: 'cursor',
            version: '1',
            signedIn: true,
            models: [],
            account: { email: null, plan: 'API key' },
          },
          { provider: 'copilot', version: '1', signedIn: true, models: [] },
        ],
      }),
    );
    expect(agents['claude-code']!.account).toBe('me@example.com');
    expect(agents['codex']).toMatchObject({ account: 'me@example.com', detail: 'ChatGPT Plus · Version 1' });
    expect(agents['cursor']).toMatchObject({ account: 'API key', detail: 'Version 1' });
    expect(agents['copilot']!.account).toBeUndefined();
  });

  it('asks for a Pocket Agent update before anything else on an old PC', () => {
    const agents = by(
      pc({
        agentVersion: '2.0.0',
        agents: [{ provider: 'codex', version: '1', signedIn: false, models: [] }],
      }),
    );
    expect(agents['codex']).toMatchObject({ state: 'update', command: 'pocket-agent update' });
    expect(agents['claude-code']!.state).toBe('ready');
  });
});
