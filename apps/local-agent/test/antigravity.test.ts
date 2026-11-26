import { describe, expect, it } from 'vitest';
import { detectAntigravity, parseModels } from '../src/providers/antigravity/detect.js';

const MODELS = `Fetching available models...
gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
not a model line
`;

describe('finding Antigravity CLI on the PC', () => {
  it('reads its models (id and name per line)', () => {
    expect(parseModels(MODELS)).toEqual([
      { id: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)', description: '' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)', description: '' },
    ]);
  });

  it('signed in when it can list its models; signed out when it can’t; null when not installed', async () => {
    const ok = await detectAntigravity({
      command: 'agy',
      run: async () => ({ ok: true, stdout: MODELS, missing: false }),
    });
    expect(ok).toMatchObject({ provider: 'antigravity', signedIn: true });
    expect(ok?.models).toHaveLength(2);

    const out = await detectAntigravity({
      command: 'agy',
      run: async () => ({ ok: false, stdout: 'Please log in', missing: false }),
    });
    expect(out).toMatchObject({ provider: 'antigravity', signedIn: false, models: [] });

    expect(
      await detectAntigravity({
        command: 'agy',
        run: async () => ({ ok: false, stdout: '', missing: true }),
      }),
    ).toBeNull();
  });
});
