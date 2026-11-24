import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFolders } from '../src/folders.js';
import type { Policy } from '../src/policy.js';

function workspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pa-folders-'));
  for (const d of ['beta', 'Alpha', 'app10', 'app2', '.git', 'nested/deeper']) {
    mkdirSync(path.join(root, d), { recursive: true });
  }
  writeFileSync(path.join(root, 'readme.md'), 'not a folder');
  return root;
}

const policyFor = (root: string): Policy => ({
  projects: [{ name: 'ws', path: root }],
  observedInstructions: false,
  wakeIdle: false,
  shareAttachments: false,
  remoteApproval: false,
});

describe('listFolders', () => {
  it('lists the folders directly inside an allowed project, sorted, without hidden ones or files', async () => {
    const root = workspace();
    const r = await listFolders(policyFor(root), root);
    expect(r.error).toBeUndefined();
    expect(r.folders.map((f) => f.name)).toEqual(['Alpha', 'app2', 'app10', 'beta', 'nested']);
    expect(r.folders[0]!.path).toBe(path.join(root, 'Alpha'));
    expect(r.truncated).toBe(false);
  });

  it('lists a folder inside an allowed project', async () => {
    const root = workspace();
    const r = await listFolders(policyFor(root), path.join(root, 'nested'));
    expect(r.folders.map((f) => f.name)).toEqual(['deeper']);
  });

  it('refuses folders outside the allowed projects, including via ..', async () => {
    const root = workspace();
    const allowed = path.join(root, 'nested');
    const policy = policyFor(allowed);
    expect((await listFolders(policy, root)).error).toBe('project_not_allowed');
    expect((await listFolders(policy, path.join(allowed, '..'))).error).toBe('project_not_allowed');
    expect((await listFolders(policy, path.join(allowed, '..', 'beta'))).error).toBe('project_not_allowed');
  });

  it('says when the folder is gone', async () => {
    const root = workspace();
    const r = await listFolders(policyFor(root), path.join(root, 'missing'));
    expect(r.error).toBe('folder_not_found');
  });

  it('leaves out links (they could point outside the allowed folder)', async () => {
    const root = workspace();
    const outside = mkdtempSync(path.join(os.tmpdir(), 'pa-outside-'));
    try {
      symlinkSync(outside, path.join(root, 'link'), 'junction');
    } catch {
      return; // no permission to make links here
    }
    const r = await listFolders(policyFor(root), root);
    expect(r.folders.map((f) => f.name)).not.toContain('link');
  });
});
