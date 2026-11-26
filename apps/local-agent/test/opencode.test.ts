import { describe, expect, it } from 'vitest';
import {
  detectOpencode,
  parseModels,
  toAppModel,
  toOpencodeModel,
} from '../src/providers/opencode/detect.js';
import { OPENCODE_PROFILE } from '../src/providers/opencode/sessions.js';

describe('OpenCode on the PC', () => {
  it('reads its models; ids with "/" travel as "::" and come back', () => {
    expect(parseModels('opencode/big-pickle\nopenrouter/meta/llama-4\nnot a model\n')).toEqual([
      { id: 'opencode::big-pickle', name: 'Big Pickle (OpenCode)', description: '' },
      { id: 'openrouter::meta::llama-4', name: 'Meta/Llama 4 (openrouter)', description: '' },
    ]);
    expect(toOpencodeModel(toAppModel('openrouter/meta/llama-4'))).toBe('openrouter/meta/llama-4');
  });

  it('usable when it lists models; null when it isn’t installed', async () => {
    const ok = await detectOpencode({
      command: 'opencode',
      run: async (_c, args) =>
        args[0] === '--version'
          ? { ok: true, stdout: '1.19.6\n', missing: false }
          : { ok: true, stdout: 'opencode/big-pickle\n', missing: false },
    });
    expect(ok).toMatchObject({ provider: 'opencode', version: '1.19.6', signedIn: true });
    expect(
      await detectOpencode({
        command: 'opencode',
        run: async () => ({ ok: false, stdout: '', missing: true }),
      }),
    ).toBeNull();
  });

  it('its modes are its own agents (Build, Plan), set as the session’s mode option', () => {
    expect(OPENCODE_PROFILE.mode('s', 'plan')).toEqual([
      { method: 'session/set_config_option', params: { sessionId: 's', configId: 'mode', value: 'plan' } },
    ]);
    expect(OPENCODE_PROFILE.mode('s', 'auto')[0]?.params).toMatchObject({ value: 'build' });
    expect(OPENCODE_PROFILE.toAgentModel?.('opencode::big-pickle')).toBe('opencode/big-pickle');
  });
});
