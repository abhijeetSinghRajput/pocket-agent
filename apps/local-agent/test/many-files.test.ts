import { describe, expect, it } from 'vitest';
import { messageContent, type LocalFile } from '../src/attachments.js';

const photo = (i: number, mb: number) =>
  ({
    path: `C:/files/p${i}.jpg`,
    ref: { mime: 'image/jpeg', name: `p${i}.jpg` },
    data: Buffer.alloc(mb * 1024 * 1024, 1),
  }) as unknown as LocalFile;

describe('many files in one message', () => {
  it('sends pictures as pictures while they fit, and names the rest for Claude to open', () => {
    const files = Array.from({ length: 6 }, (_, i) => photo(i, 4));
    const content = messageContent('look', files) as Array<{ type: string; text?: string }>;
    expect(content.filter((b) => b.type === 'image')).toHaveLength(4);
    const note = content.at(-1)!.text!;
    expect(note).toContain('C:/files/p4.jpg');
    expect(note).toContain('C:/files/p5.jpg');
    expect(note).not.toContain('p0.jpg');
  });
});
