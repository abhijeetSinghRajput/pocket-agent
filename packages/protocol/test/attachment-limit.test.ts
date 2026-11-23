import { describe, expect, it } from 'vitest';
import { ATTACHMENT_MAX_PER_MESSAGE, attachmentLimit } from '../src/index.js';

describe('attachmentLimit', () => {
  it('lets newer PC agents take many files, and keeps older ones at 4', () => {
    expect(attachmentLimit('0.1.5')).toBe(ATTACHMENT_MAX_PER_MESSAGE);
    expect(attachmentLimit('0.2.0-beta.1')).toBe(ATTACHMENT_MAX_PER_MESSAGE);
    expect(attachmentLimit('0.1.4')).toBe(4);
    expect(attachmentLimit(undefined)).toBe(4);
  });
});
