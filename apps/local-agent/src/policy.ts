import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * What the PC owner allows remote users to do on this PC. Enforced here, on the PC — the
 * backend only displays it. A compromised dashboard account can't widen it.
 */
export const Policy = z.object({
  /** Folders managed sessions may be started in from the dashboard. */
  projects: z.array(z.object({ name: z.string(), path: z.string() })).default([]),
  /** Instructions to sessions the user started themselves (delivered between turns). Off by default. */
  observedInstructions: z.boolean().default(false),
  /**
   * An instruction to an idle session the user started is run at once, by resuming that session
   * through the SDK (instead of waiting for the next turn on the PC). Needs observedInstructions. Off by default.
   */
  wakeIdle: z.boolean().default(false),
  /**
   * Photos and PDFs the user attaches to prompts in the editor are uploaded so the app can show
   * them (kept 30 days). Off by default: they are the user's files, leaving the PC.
   */
  shareAttachments: z.boolean().default(false),
  /**
   * Permission requests may be decided in Pocket Agent. On by default (the app is for deciding
   * when away from the PC); `pocket-agent approvals disable` turns it off, and that choice is kept.
   */
  remoteApproval: z.boolean().default(true),
});
export type Policy = z.infer<typeof Policy>;

/** Nothing allowed: what an unreadable policy file means. */
const RESTRICTIVE: Policy = {
  projects: [],
  observedInstructions: false,
  wakeIdle: false,
  shareAttachments: false,
  remoteApproval: false,
};

const file = (home: string) => path.join(home, 'policy.json');

export async function loadPolicy(home: string): Promise<Policy> {
  const raw = await readFile(file(home), 'utf8').catch(() => null);
  if (!raw) return Policy.parse({});
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = Policy.safeParse(json);
  // A corrupt policy must not silently grant anything: fall back to everything off.
  return parsed.success ? parsed.data : RESTRICTIVE;
}

export async function savePolicy(home: string, policy: Policy): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(file(home), JSON.stringify(policy, null, 2) + '\n', 'utf8');
}

/** Canonical form for comparing folders (Windows paths are case-insensitive). */
export function normalizeProjectPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '');
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isAllowedProject(policy: Policy, candidate: string): Policy['projects'][number] | undefined {
  const want = normalizeProjectPath(candidate);
  return policy.projects.find((p) => normalizeProjectPath(p.path) === want);
}
