import { FOLDER_LIST_MAX } from '@pocket-agent/protocol';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isAllowedProject, type Policy } from './policy.js';

export interface FolderListing {
  folders: Array<{ name: string; path: string }>;
  truncated: boolean;
  error?: string;
}

/**
 * The folders directly inside `folder`, for browsing from the app. Only an allowed project or a
 * folder inside one is listed (the PC decides, whatever the backend asked). Hidden folders (".git")
 * and links are left out: a link could lead outside the allowed folder. Names only, never files.
 */
export async function listFolders(policy: Policy, folder: string): Promise<FolderListing> {
  const allowed = isAllowedProject(policy, folder);
  if (!allowed) return { folders: [], truncated: false, error: 'project_not_allowed' };
  let entries;
  try {
    entries = await readdir(allowed.path, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      folders: [],
      truncated: false,
      error: code === 'ENOENT' || code === 'ENOTDIR' ? 'folder_not_found' : 'folder_unreadable',
    };
  }
  const names = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  return {
    folders: names.slice(0, FOLDER_LIST_MAX).map((name) => ({ name, path: path.join(allowed.path, name) })),
    truncated: names.length > FOLDER_LIST_MAX,
  };
}
