import { describe, expect, it } from 'vitest';
import { summarizeToolInput, summarizeToolOutput } from '../src/providers/claude-code/summarize.js';

describe('AskUserQuestion summaries', () => {
  const input = {
    questions: [
      {
        question: 'Idle session: how to handle it?',
        header: 'Idle session',
        multiSelect: false,
        options: [
          { label: 'Resume', description: 'Resume via the SDK' },
          { label: 'Warn', description: 'UI warning only' },
        ],
      },
    ],
  };

  it('forwards the question text and options, bounded', () => {
    const out = JSON.parse(summarizeToolInput('AskUserQuestion', input)) as { questions: unknown[] };
    expect(out.questions).toEqual([
      {
        question: 'Idle session: how to handle it?',
        header: 'Idle session',
        options: [
          { label: 'Resume', description: 'Resume via the SDK' },
          { label: 'Warn', description: 'UI warning only' },
        ],
      },
    ]);
    const many = { questions: Array.from({ length: 9 }, () => input.questions[0]) };
    expect(
      (JSON.parse(summarizeToolInput('AskUserQuestion', many)) as { questions: unknown[] }).questions,
    ).toHaveLength(4);
  });

  it('forwards only the answers from the response', () => {
    const out = summarizeToolOutput('AskUserQuestion', {
      questions: input.questions,
      answers: { 'Idle session: how to handle it?': 'Resume' },
    });
    expect(JSON.parse(out)).toEqual({ answers: { 'Idle session: how to handle it?': 'Resume' } });
    expect(summarizeToolOutput('AskUserQuestion', 'declined')).toBe('');
  });

  it('still sends only argument names for unknown tools', () => {
    expect(JSON.parse(summarizeToolInput('mcp__x__secret', { token: 'abc' }))).toEqual({
      arguments: ['token'],
    });
  });
});
