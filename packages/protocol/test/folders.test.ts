import { describe, expect, it } from 'vitest';
import { isWithinFolder } from '../src/index.js';

describe('isWithinFolder', () => {
  it('is the folder or anything inside it, never a sibling or the parent', () => {
    expect(isWithinFolder('C:\\Users\\me\\workspace', 'C:\\Users\\me\\workspace')).toBe(true);
    expect(isWithinFolder('C:\\Users\\me\\workspace\\pocket_agent', 'C:\\Users\\me\\workspace\\')).toBe(true);
    expect(isWithinFolder('c:/users/ME/Workspace/a/b', 'C:\\Users\\me\\workspace')).toBe(true);
    expect(isWithinFolder('C:\\Users\\me\\workspace-old', 'C:\\Users\\me\\workspace')).toBe(false);
    expect(isWithinFolder('C:\\Users\\me', 'C:\\Users\\me\\workspace')).toBe(false);
  });

  it('is case-sensitive off Windows and never matches an empty folder', () => {
    expect(isWithinFolder('/home/me/Work/api', '/home/me/work')).toBe(false);
    expect(isWithinFolder('/home/me/work/api', '/home/me/work')).toBe(true);
    expect(isWithinFolder('/anything', '')).toBe(false);
  });
});
