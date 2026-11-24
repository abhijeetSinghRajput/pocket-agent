import { recentWorkspaces } from '@pocket-agent/core';
import { describe, expect, it } from 'vitest';

const at = (min: number) => new Date(Date.UTC(2026, 10, 24, 12, min)).toISOString();
const s = (id: string, deviceId: string, projectPath: string, min: number) =>
  ({
    id,
    deviceId,
    projectName: projectPath.split(/[\\/]/).filter(Boolean).pop(),
    projectPath,
    lastActivityAt: at(min),
  }) as never;
const d = (id: string, status: 'Online' | 'Offline', projects: string[]) =>
  ({ id, name: `PC ${id}`, status, projects: projects.map((path) => ({ name: path, path })) }) as never;

describe('recentWorkspaces', () => {
  const devices = [d('a', 'Online', ['C:\\work']), d('b', 'Offline', ['D:\\x'])];

  it('newest first, each folder once (case and slashes aside)', () => {
    const list = recentWorkspaces(
      [s('1', 'a', 'C:\\work\\api', 1), s('2', 'a', 'C:\\work\\web', 5), s('3', 'a', 'c:/WORK/api/', 9)],
      devices,
    );
    expect(list.map((w) => w.path)).toEqual(['c:/WORK/api/', 'C:\\work\\web']);
    expect(list[0]).toMatchObject({ deviceId: 'a', deviceName: 'PC a' });
  });

  it('only folders an online PC still allows', () => {
    const list = recentWorkspaces(
      [s('1', 'b', 'D:\\x\\y', 3), s('2', 'a', 'C:\\other', 4), s('3', 'gone', 'C:\\work', 5)],
      devices,
    );
    expect(list).toEqual([]);
  });

  it('keeps to the limit', () => {
    const many = [1, 2, 3, 4, 5, 6].map((i) => s(String(i), 'a', `C:\\work\\p${i}`, i));
    expect(recentWorkspaces(many, devices, 4)).toHaveLength(4);
  });
});
