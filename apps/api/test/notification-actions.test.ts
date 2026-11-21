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
