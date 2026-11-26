import { describe, expect, it } from 'vitest';
import type { Transport } from '../src/providers/codex/rpc.js';
import { COPILOT_PROFILE, detectCopilot } from '../src/providers/copilot/copilot.js';

/** A stand-in for `copilot --acp` that answers every request, or refuses the session list. */
function fakeAcp(signedIn: boolean): () => Transport {
  return () => {
    let onLine: (line: string) => void = () => undefined;
    return {
      write: (line) => {
        const msg = JSON.parse(line) as { id?: number; method?: string };
        if (msg.id === undefined) return;
        const refused = msg.method === 'session/list' && !signedIn;
        queueMicrotask(() =>
          onLine(
            JSON.stringify(
              refused
                ? { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Authentication required' } }
                : { jsonrpc: '2.0', id: msg.id, result: {} },
            ),
          ),
        );
      },
      onLine: (l) => void (onLine = l),
      onClose: () => undefined,
      close: () => undefined,
    };
  };
}

describe('GitHub Copilot CLI on the PC', () => {
  const version = async () => ({ stdout: 'GitHub Copilot CLI 1.0.116.\n', missing: false });

  it('signed in when it lists its sessions; signed out when it refuses; null when not installed', async () => {
    expect(await detectCopilot({ command: 'copilot', run: version, connect: fakeAcp(true) })).toEqual({
      provider: 'copilot',
      version: '1.0.116',
      signedIn: true,
      models: [],
    });
    expect(
      (await detectCopilot({ command: 'copilot', run: version, connect: fakeAcp(false) }))?.signedIn,
    ).toBe(false);
    expect(
      await detectCopilot({ command: 'copilot', run: async () => ({ stdout: '', missing: true }) }),
    ).toBeNull();
  });

  it('modes are Copilot’s own settings; never "allow all" or autopilot', () => {
    const all = (['default', 'acceptEdits', 'auto', 'plan'] as const).map((m) =>
      COPILOT_PROFILE.mode('s', m),
    );
    expect(COPILOT_PROFILE.mode('s', 'default').at(-1)?.params).toMatchObject({
      configId: 'allow_all',
      value: 'off',
    });
    expect(COPILOT_PROFILE.mode('s', 'auto').at(-1)?.params).toMatchObject({
      configId: 'allow_all',
      value: 'auto',
    });
    expect(String(COPILOT_PROFILE.mode('s', 'plan')[0]?.params['modeId'])).toMatch(/#plan$/);
    expect(JSON.stringify(all)).not.toMatch(/autopilot|"value":"on"/);
    expect(COPILOT_PROFILE.resume).toBe('load');
  });
});
