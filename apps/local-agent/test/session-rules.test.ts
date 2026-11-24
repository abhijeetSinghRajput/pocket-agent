import { describe, expect, it } from 'vitest';
import { describeRules, sessionRules } from '../src/providers/claude-code/session-rules.js';

describe('"Allow for this session" from the phone', () => {
  it('keeps allow rules, folders and accepting edits, always for this session only', () => {
    const rules = sessionRules([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'localSettings',
        rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      },
      { type: 'addDirectories', destination: 'projectSettings', directories: ['C:\\work\\shared'] },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ]);
    expect(rules).toEqual([
      {
        type: 'addRules',
        behavior: 'allow',
        destination: 'session',
        rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
      },
      { type: 'addDirectories', destination: 'session', directories: ['C:\\work\\shared'] },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ]);
    expect(describeRules(rules)).toBe('Bash(npm test:*), files in C:\\work\\shared, all edits');
  });

  it('never widens Claude Code: other modes, deny rules, removals and junk are dropped', () => {
    expect(
      sessionRules([
        { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
        { type: 'setMode', mode: 'dontAsk', destination: 'session' },
        { type: 'addRules', behavior: 'deny', destination: 'session', rules: [{ toolName: 'Bash' }] },
        { type: 'replaceRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash' }] },
        { type: 'removeRules', behavior: 'deny', destination: 'session', rules: [{ toolName: 'Bash' }] },
        { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ ruleContent: 'no tool' }] },
        'nonsense',
        null,
      ]),
    ).toEqual([]);
    expect(sessionRules(undefined)).toEqual([]);
    expect(describeRules([])).toBeUndefined();
  });
});
