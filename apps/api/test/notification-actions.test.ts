import { androidPresentation } from '../src/notifications/push.js';
import { describe, expect, it } from 'vitest';
import { yesNoActions } from '../src/notifications/triggers.js';

const question = (questions: unknown) => ({
  id: 'a1',
  toolName: 'AskUserQuestion',
  requestPayload: { input: JSON.stringify({ questions }) },
});

describe('buttons on a notification: yes/no only', () => {
  it('a permission request gets Allow and Deny', () => {
    const { actions } = yesNoActions({ id: 'a1', toolName: 'Bash', requestPayload: { input: '{}' } });
    expect(actions?.map((a) => [a.title, a.decision])).toEqual([
      ['Allow', 'allow'],
      ['Deny', 'deny'],
    ]);
  });

  it('a question with exactly two options gets them as buttons, each sending its answer', () => {
    const { actions } = yesNoActions(
      question([{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'No' }] }]),
    );
    expect(actions?.map((a) => a.title)).toEqual(['Yes', 'No']);
    expect(actions?.[1]).toMatchObject({ decision: 'allow', answers: { 'Deploy now?': 'No' } });
  });

  it('radio (3+ options), checkbox (multi-select) or several questions: no buttons, the app opens', () => {
    const three = [{ label: 'Rock' }, { label: 'Paper' }, { label: 'Scissors' }];
    expect(yesNoActions(question([{ question: 'Pick', options: three }])).actions).toBeUndefined();
    expect(
      yesNoActions(
        question([{ question: 'Sizes', multiSelect: true, options: [{ label: 'S' }, { label: 'L' }] }]),
      ).actions,
    ).toBeUndefined();
    const two = { question: 'A?', options: [{ label: 'Yes' }, { label: 'No' }] };
    expect(yesNoActions(question([two, { ...two, question: 'B?' }])).actions).toBeUndefined();
    expect(yesNoActions(question('not json')).actions).toBeUndefined();
  });
});

describe('Android push presentation', () => {
  const base = {
    title: 'Permission needed · Bash',
    body: 'deploy on PC. Tap to review.',
    link: '/approvals',
    tag: 't',
  };

  it('a permission request gets the Allow / Deny button set and the urgent channel', () => {
    const actions = yesNoActions({ id: 'a1', toolName: 'Bash', requestPayload: {} }).actions!;
    expect(androidPresentation({ ...base, priority: 'critical', actions })).toEqual({
      message: base.body,
      channelId: 'approvals',
      categoryId: 'permission',
      approvalId: 'a1',
    });
  });

  it('anything else is plain text on the default channel', () => {
    expect(androidPresentation({ ...base, priority: 'normal' })).toEqual({
      message: base.body,
      channelId: 'default',
    });
    // A yes/no question carries answers: no Allow / Deny set (tapping opens the app).
    const question = [
      { id: 'answer-0', title: 'Yes', approvalId: 'q', decision: 'allow' as const, answers: { q: 'Yes' } },
      { id: 'answer-1', title: 'No', approvalId: 'q', decision: 'allow' as const, answers: { q: 'No' } },
    ];
    expect(androidPresentation({ ...base, priority: 'critical', actions: question })).not.toHaveProperty(
      'categoryId',
    );
  });
});

describe('"Allow for session" on the notification', () => {
  const base = {
    title: 'Permission needed · Bash',
    body: 'b',
    link: '/approvals',
    tag: 't',
    priority: 'critical' as const,
  };

  it('is the third button only when the PC offered it, with its own button set', () => {
    const plain = yesNoActions({ id: 'a1', toolName: 'Bash', requestPayload: { input: '{}' } }).actions!;
    expect(plain.map((a) => a.id)).toEqual(['allow', 'deny']);
    const offered = yesNoActions({
      id: 'a2',
      toolName: 'Bash',
      requestPayload: { input: '{}', remember: 'Bash(npm test:*)' },
    }).actions!;
    expect(offered.map((a) => a.id)).toEqual(['allow', 'deny', 'allow-session']);
    expect(offered[2]).toMatchObject({ decision: 'allow', remember: true });
    expect(androidPresentation({ ...base, actions: offered })).toMatchObject({
      categoryId: 'permission-session',
      approvalId: 'a2',
    });
  });
});
