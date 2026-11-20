// Helpers that drive the REAL Local Agent CLI and hook relay from E2E tests.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLI = path.resolve(import.meta.dirname, '../../local-agent/dist/cli.js');
export const RELAY = path.resolve(import.meta.dirname, '../../local-agent/dist/hook-relay.js');
const FIXTURES = path.resolve(
  import.meta.dirname,
  '../../local-agent/test/fixtures/claude-code-hooks.v2.1.325.json',
);

/**
 * Isolated agent state + an isolated Claude Code config dir, so tests never read the developer's
 * real Claude sessions or settings.
 */
export function agentEnv(): NodeJS.ProcessEnv & { POCKET_AGENT_HOME: string; CLAUDE_CONFIG_DIR: string } {
  const claudeDir = mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-e2e-claude-'));
  mkdirSync(path.join(claudeDir, 'sessions'));
  return {
    ...process.env,
    POCKET_AGENT_HOME: mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-e2e-')),
    CLAUDE_CONFIG_DIR: claudeDir,
  };
}

export type AgentProcess = ChildProcess & { exited: Promise<number | null>; output: () => string };

export function startAgent(env: NodeJS.ProcessEnv): AgentProcess {
  const child = spawn(process.execPath, [CLI, 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  return Object.assign(child, { exited, output: () => out });
}

export function cli(env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
}

/** Runs the real hook relay exactly as Claude Code would: JSON on stdin. */
export function relay(env: { POCKET_AGENT_HOME: string }, payload: object): void {
  execFileSync(process.execPath, [RELAY, '--pocket-agent-hook', '--home', env.POCKET_AGENT_HOME], {
    input: JSON.stringify(payload),
  });
}

/** Recorded Claude Code hook payloads, re-keyed to a fresh session id and project dir. */
export function hookPayloads(sessionId: string, cwd: string): Record<string, Record<string, unknown>> {
  const all = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Array<Record<string, unknown>>;
  return Object.fromEntries(
    all.map((p) => [p['hook_event_name'] as string, { ...p, session_id: sessionId, cwd }]),
  );
}
