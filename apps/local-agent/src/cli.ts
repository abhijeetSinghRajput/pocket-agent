#!/usr/bin/env node
import { PROTOCOL_VERSION } from '@pocket-agent/protocol';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiRequestError, confirmSecret, pairDevice, rotateSecret } from './api-client.js';
import {
  autostartCommand,
  autostartCommandRegistered,
  autostartSupported,
  disableAutostart,
  enableAutostart,
} from './autostart.js';
import {
  clearPidFileSync,
  isEphemeralInstall,
  logFile,
  runningPid,
  spawnBackground,
  stopRunning,
  writePidFile,
} from './background.js';
import { spawn } from 'node:child_process';
import {
  currentPlatform,
  DEFAULT_API_URL,
  deleteConfig,
  loadConfig,
  saveConfig,
  validateApiUrl,
} from './config.js';
import { callLocalAgent } from './local-client.js';
import { agentHome } from './paths.js';
import { isAllowedProject, loadPolicy, normalizeProjectPath, savePolicy, type Policy } from './policy.js';
import {
  defaultSettingsPath,
  hooksStatus,
  PERMISSION_HOOK_TIMEOUT_S,
  uninstallHooks,
} from './providers/claude-code/install.js';
import type { QueryFn } from './providers/claude-code/managed.js';
import { createSecretStore } from './secret-store.js';
import { AgentService } from './service.js';
import {
  autostartCurrent,
  checkApi,
  claudeCodeDetected,
  ensureAutostart,
  ensureHooks,
  ensureRunning,
  hooksCurrent,
  liveStatus,
  MIN_NODE,
  missingWorkspaces,
  nodeSupported,
  pairingState,
  stableInstall,
  waitOnline,
  type SetupContext,
} from './setup.js';
import { ask, bold, confirm, dim, green, heading, interactive, line, red, withSpinner } from './ui.js';

const { name: PACKAGE_NAME, version } = createRequire(import.meta.url)('../package.json') as {
  name: string;
  version: string;
};
/** This file. Hooks and auto-start point at the installed copy, so it must be a stable path. */
const CLI_PATH = fileURLToPath(import.meta.url);
const RELAY_PATH = path.join(path.dirname(CLI_PATH), 'hook-relay.js');

// The agent is long-running: losing its console (terminal closed, parent process gone) must not
// kill it. Writes to a closed stdout/stderr raise EPIPE asynchronously; ignore them.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => undefined);

const log = (level: 'info' | 'warn' | 'error', msg: string) => {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (level === 'info') console.log(line);
  else console.error(line);
};

function fail(msg: string, code = 1): never {
  console.error(`Error: ${msg}`);
  process.exit(code);
}

const CONNECT_HINT = 'Get a code in the Pocket Agent app (Add device), then run: pocket-agent connect <code>';

async function requirePaired(home: string) {
  const config = await loadConfig(home);
  if (!config) fail(`This PC is not connected. ${CONNECT_HINT}`);
  if (config.revokedAt) fail(`This PC was removed from your account. ${CONNECT_HINT}`);
  const secret = await createSecretStore(home).load();
  if (!secret) fail(`This PC's credentials are missing. ${CONNECT_HINT}`);
  return { config, secret };
}

const setupContext = (): SetupContext => ({
  home: agentHome(),
  cliPath: CLI_PATH,
  relayPath: RELAY_PATH,
  nodePath: process.execPath,
  version,
});

async function pairThisPc(code: string, apiUrl: string, name: string): Promise<void> {
  try {
    validateApiUrl(apiUrl);
  } catch (e) {
    fail((e as Error).message);
  }
  const home = agentHome();
  try {
    const res = await pairDevice(apiUrl, {
      code,
      name: name.slice(0, 100),
      platform: currentPlatform(),
      agentVersion: version,
    });
    await saveConfig(home, {
      apiUrl,
      deviceId: res.deviceId,
      deviceName: name,
      pairedAt: new Date().toISOString(),
    });
    await createSecretStore(home).save(res.deviceSecret);
  } catch (e) {
    fail(e instanceof ApiRequestError ? e.message : `Pairing failed: ${(e as Error).message}`);
  }
}

async function installClaudeHooks(settings?: string): Promise<void> {
  if (!existsSync(RELAY_PATH)) fail(`Hook relay not found at ${RELAY_PATH}. Build the agent first.`);
  const file = settings ?? defaultSettingsPath();
  try {
    const r = await ensureHooks(setupContext(), file);
    if (!r.changed)
      return void console.log(`Pocket Agent hooks are already installed and up to date in ${file}`);
    console.log(`Installed Pocket Agent hooks in ${file}`);
    if (r.backupPath) console.log(`Backup of the previous file: ${r.backupPath}`);
    console.log('The hooks only report activity; they never answer permission prompts.');
    console.log('Sessions that are already running pick this up after a restart.');
  } catch (e) {
    fail((e as Error).message);
  }
}

/** Refuses when running from npx's temporary cache: hooks/auto-start would point at a path that vanishes. */
function requireStableInstall(what: string): void {
  if (isEphemeralInstall(CLI_PATH)) {
    fail(
      `${what} needs Pocket Agent installed, not run through npx. Install it: npm install -g ${PACKAGE_NAME}`,
    );
  }
}

async function startInBackground(): Promise<void> {
  const home = agentHome();
  const pid = await runningPid(home);
  if (pid) return void console.log(`Pocket Agent is already running (PID ${pid}).`);
  await requirePaired(home);
  const child = spawnBackground(home, CLI_PATH);
  // Record it now, so `status`/`stop` see it before the child has finished starting.
  await writePidFile(home, child);
  console.log(`Pocket Agent is running in the background (PID ${child}). Log: ${logFile(home)}`);
}

async function enableStartAtSignIn(): Promise<boolean> {
  if (!autostartSupported()) {
    console.log(
      'Starting at sign-in is only supported on Windows for now. Run: pocket-agent start --background',
    );
    return false;
  }
  requireStableInstall('Starting at sign-in');
  await enableAutostart(autostartCommand(process.execPath, CLI_PATH));
  console.log('Pocket Agent will start automatically when you sign in to Windows.');
  return true;
}

interface ConnectOptions {
  api?: string;
  name: string;
  workspace?: string[];
  approvals?: boolean;
  yes?: boolean;
  hooks: boolean;
  autostart: boolean;
}

/** Adds folders to the allowlist; returns the ones newly added. */
async function addWorkspaces(policy: Policy, dirs: string[]): Promise<string[]> {
  const added: string[] = [];
  for (const dir of dirs) {
    const full = path.resolve(dir);
    const st = await stat(full).catch(() => null);
    if (!st?.isDirectory()) {
      line('warn', 'Workspace', `not a folder, skipped: ${full}`);
      continue;
    }
    if (isAllowedProject(policy, full) || policy.projects.length >= 50) continue;
    policy.projects.push({ name: path.basename(full).slice(0, 200) || full, path: full });
    added.push(full);
  }
  return added;
}

/**
 * The one command a user needs: pair (when given a code), connect Claude Code, configure the
 * background service and start at sign-in, optionally allow a workspace and phone approvals, then
 * wait until the server actually sees this PC online. Safe to re-run: finished steps are skipped.
 */
async function connectThisPc(codeArg: string | undefined, opts: ConnectOptions): Promise<void> {
  // Run through npx (the one command the app shows): install for good, then continue with the
  // installed copy, since hooks and start-at-sign-in must point at a path that stays.
  if (isEphemeralInstall(CLI_PATH)) return installThenConnect();

  const ctx = setupContext();
  const ask_ = !opts.yes && interactive();
  heading('Connect this PC to Pocket Agent');

  // 1. Environment
  if (!nodeSupported()) {
    line('fail', 'Node.js', `v${process.versions.node} (needs ${MIN_NODE.join('.')} or newer)`);
    fail('Update Node.js from https://nodejs.org, then run this again.');
  }
  line('ok', 'Node.js', `v${process.versions.node}`);
  const claude = claudeCodeDetected();
  line(
    claude ? 'ok' : 'warn',
    'Claude Code',
    claude ? 'found' : 'not found yet; install it and Pocket Agent picks it up automatically',
  );

  // 2. Which server
  const before = await pairingState(ctx.home);
  const code = codeArg?.trim();
  if (!code && before.kind !== 'paired') fail(`No pairing code. ${CONNECT_HINT}`);
  const previousApi = before.kind === 'not-paired' ? undefined : before.apiUrl;
  const apiUrl = opts.api ?? process.env['POCKET_AGENT_API_URL'] ?? previousApi ?? DEFAULT_API_URL;
  try {
    validateApiUrl(apiUrl);
  } catch (e) {
    fail((e as Error).message);
  }
  const reach = await withSpinner('Reaching the Pocket Agent server…', () => checkApi(apiUrl));
  if (!reach.ok) {
    line('fail', 'Server', reach.reason);
    console.error(
      `\n${red("Can't reach Pocket Agent.")} Check your internet connection, then run this again.`,
    );
    if (opts.api) console.error(dim(`Also check the server address: ${apiUrl}`));
    process.exit(1);
  }
  line('ok', 'Server', new URL(apiUrl).host);

  // 3. Pairing
  let repaired = false;
  if (code) {
    // Re-pairing while an old agent runs would leave it on stale credentials.
    await stopRunning(ctx.home).catch(() => false);
    await withSpinner('Pairing…', () => pairThisPc(code, apiUrl, opts.name));
    repaired = true;
    line('ok', 'Paired', `as "${opts.name}"`);
    if (before.kind === 'paired') {
      line(
        'info',
        'Note',
        `replaced the previous pairing; remove "${before.deviceName}" in the app if it's still listed`,
      );
    }
  } else if (before.kind === 'paired') {
    line('ok', 'Paired', `already, as "${before.deviceName}"`);
  }

  // 4. Claude Code integration
  if (opts.hooks) {
    try {
      const r = await ensureHooks(ctx);
      line('ok', 'Claude Code link', r.changed ? 'set up' : 'already set up');
    } catch (e) {
      line('warn', 'Claude Code link', (e as Error).message);
    }
  }

  // 5. Workspace and phone approvals (asked once; re-runs keep what you chose)
  const policy = await loadPolicy(ctx.home);
  const policyBefore = JSON.stringify(policy);
  const requested = opts.workspace ?? [];
  if (!requested.length && !policy.projects.length && ask_) {
    const cwd = process.cwd();
    const suggestion = normalizeProjectPath(cwd) === normalizeProjectPath(os.homedir()) ? '' : cwd;
    const answer = await ask(
      'Folder where your phone may start Claude sessions (Enter to skip):',
      suggestion,
    );
    if (answer) requested.push(answer);
  }
  const added = await addWorkspaces(policy, requested);
  if (added.length) for (const p of added) line('ok', 'Workspace', p);
  else if (policy.projects.length) line('ok', 'Workspaces', `${policy.projects.length} allowed`);
  else line('info', 'Workspace', 'none yet (add one later: pocket-agent projects add <folder>)');

  if (opts.approvals) policy.remoteApproval = true;
  else if (!policy.remoteApproval && ask_) {
    policy.remoteApproval = await confirm('Approve Claude’s permission requests from your phone?', true);
  }
  line(
    policy.remoteApproval ? 'ok' : 'info',
    'Phone approvals',
    policy.remoteApproval ? 'on' : 'off (turn on later: pocket-agent approvals enable)',
  );
  const policyChanged = JSON.stringify(policy) !== policyBefore;
  if (policyChanged) await savePolicy(ctx.home, policy);

  // 6. Background service and start at sign-in
  if (opts.autostart) {
    try {
      const a = await ensureAutostart(ctx);
      if (a === 'unsupported') line('info', 'Start at sign-in', 'not supported on this OS yet');
      else line('ok', 'Start at sign-in', a === 'enabled' ? 'on' : 'already on');
    } catch (e) {
      line('warn', 'Start at sign-in', (e as Error).message);
    }
  }
  let run;
  try {
    run = await ensureRunning(ctx, repaired);
  } catch (e) {
    line('fail', 'Background service', (e as Error).message);
    fail('Could not start Pocket Agent. Run: pocket-agent doctor');
  }
  if (run.state === 'already' && policyChanged) {
    await callLocalAgent(ctx.home, 'POST', '/policy/reload').catch(() => undefined);
  }
  line('ok', 'Background service', run.state === 'already' ? 'already running' : 'running');

  // 7. Verify: the server must actually see this PC.
  const online = await withSpinner('Connecting…', () => waitOnline(ctx.home));
  if (!online.ok) {
    line('fail', 'Online', online.reason === 'exited' ? 'the agent stopped' : 'not connected yet');
    console.error(`\n${red("Pocket Agent couldn't connect to the server.")}`);
    if (online.logTail.length) console.error(dim(online.logTail.map((l) => `  ${l}`).join('\n')));
    console.error(`\nCheck your internet connection, then run: ${bold('pocket-agent doctor --fix')}`);
    process.exit(1);
  }
  line('ok', 'Online', 'connected');
  console.log(`\n${green(bold('Your PC is connected!'))} Open Pocket Agent on your phone.`);
  console.log(
    dim(
      'Pocket Agent runs in the background and starts with Windows. Check it any time: pocket-agent status',
    ),
  );
}

/** Undoes what `connect` set up on this PC. Each part is independent; failures are reported, not fatal. */
async function disconnectThisPc(): Promise<void> {
  const home = agentHome();
  const step = async (label: string, work: () => Promise<string>) => {
    try {
      line('ok', label, await work());
    } catch (e) {
      line('warn', label, (e as Error).message);
    }
  };
  await step('Background service', async () => ((await stopRunning(home)) ? 'stopped' : 'was not running'));
  if (autostartSupported()) {
    await step('Start at sign-in', async () => ((await disableAutostart()) ? 'off' : 'was off'));
  }
  await step('Claude Code link', async () =>
    (await uninstallHooks(defaultSettingsPath())).removed ? 'removed' : 'was not set up',
  );
  await step('Credentials', async () => {
    await createSecretStore(home).clear();
    await deleteConfig(home);
    return 'removed';
  });
}

/** `npx … connect`: installs this version globally, then re-runs the same command from there. */
async function installThenConnect(): Promise<never> {
  const prefix = (await npmOutput(['prefix', '-g'])).trim();
  const modules =
    process.platform === 'win32'
      ? path.join(prefix, 'node_modules')
      : path.join(prefix, 'lib', 'node_modules');
  const pkgDir = path.join(modules, ...PACKAGE_NAME.split('/'));
  const installed = path.join(pkgDir, 'dist', 'cli.js');
  const current = await readFile(path.join(pkgDir, 'package.json'), 'utf8')
    .then((t) => (JSON.parse(t) as { version?: string }).version)
    .catch(() => undefined);
  if (!prefix || current !== version) {
    console.log(`Installing Pocket Agent ${version} on this PC…`);
    // A running older agent holds its files open; it is restarted by connect anyway.
    await stopRunning(agentHome()).catch(() => false);
    const code = await npmGlobal([
      'install',
      '-g',
      `${PACKAGE_NAME}@${version}`,
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
    ]);
    if (code !== 0)
      fail(`Could not install Pocket Agent (npm exited with ${code}). Try: npm install -g ${PACKAGE_NAME}`);
  }
  if (!existsSync(installed))
    fail(`Installed, but not found at ${installed}. Run: pocket-agent connect <code>`);
  const child = spawn(process.execPath, [installed, ...process.argv.slice(2)], { stdio: 'inherit' });
  const exit = await new Promise<number>((r) => child.on('exit', (c) => r(c ?? 1)));
  process.exit(exit);
}

function npmOutput(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('npm', args, { shell: process.platform === 'win32', windowsHide: true });
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => resolve(''));
    child.on('exit', () => resolve(out));
  });
}

/** Runs npm (global install/uninstall) with its output shown; resolves with the exit code. */
function npmGlobal(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

interface Check {
  label: string;
  mark: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  /** Safe automatic repair, run by `doctor --fix`. Returns what it did. */
  fix?: () => Promise<string>;
  /** What the user can do when there is no automatic repair. */
  hint?: string;
}

/** Every piece of the setup, checked; used by `status` (no repairs) and `doctor`. */
async function runChecks(full: boolean): Promise<Check[]> {
  const ctx = setupContext();
  const checks: Check[] = [];
  const pairing = await pairingState(ctx.home);
  const paired = pairing.kind === 'paired';

  if (full) {
    checks.push(
      nodeSupported()
        ? { label: 'Node.js', mark: 'ok', detail: `v${process.versions.node}` }
        : {
            label: 'Node.js',
            mark: 'fail',
            detail: `v${process.versions.node}, needs ${MIN_NODE.join('.')}+`,
            hint: 'Update Node.js from https://nodejs.org',
          },
      stableInstall(ctx)
        ? { label: 'Installation', mark: 'ok', detail: `${version}` }
        : {
            label: 'Installation',
            mark: 'fail',
            detail: 'running through npx',
            hint: `Install it: npm install -g ${PACKAGE_NAME}`,
          },
      claudeCodeDetected()
        ? { label: 'Claude Code', mark: 'ok', detail: 'found' }
        : {
            label: 'Claude Code',
            mark: 'warn',
            detail: 'not found',
            hint: 'Install Claude Code (https://claude.com/claude-code)',
          },
    );
  }

  checks.push(
    pairing.kind === 'paired'
      ? { label: 'Paired', mark: 'ok', detail: `as "${pairing.deviceName}"` }
      : {
          label: 'Paired',
          mark: 'fail',
          detail:
            pairing.kind === 'revoked'
              ? 'this PC was removed from your account'
              : pairing.kind === 'no-secret'
                ? 'credentials missing'
                : 'not connected',
          hint: CONNECT_HINT,
        },
  );

  if (full && pairing.kind !== 'not-paired') {
    const reach = await withSpinner('Reaching the server…', () => checkApi(pairing.apiUrl, 20_000));
    checks.push(
      reach.ok
        ? { label: 'Server', mark: 'ok', detail: `${new URL(pairing.apiUrl).host} (${reach.ms} ms)` }
        : { label: 'Server', mark: 'fail', detail: reach.reason, hint: 'Check your internet connection.' },
    );
  }

  const pid = await runningPid(ctx.home);
  const startFix = async () => {
    const r = await ensureRunning(ctx);
    const online = await withSpinner('Connecting…', () => waitOnline(ctx.home, 45_000));
    return `${r.state === 'already' ? 'was running' : 'started'}; ${online.ok ? 'online' : 'still not online'}`;
  };
  const restartFix = async () => {
    await ensureRunning(ctx, true);
    const online = await withSpinner('Connecting…', () => waitOnline(ctx.home, 45_000));
    return online.ok ? 'restarted; online' : 'restarted; still not online (see the log)';
  };
  if (!pid) {
    checks.push({
      label: 'Background service',
      mark: paired ? 'fail' : 'info',
      detail: 'not running',
      ...(paired ? { fix: startFix } : {}),
    });
  } else {
    checks.push({ label: 'Background service', mark: 'ok', detail: `running (PID ${pid})` });
    const live = await liveStatus(ctx.home);
    checks.push(
      live?.connected
        ? { label: 'Online', mark: 'ok', detail: 'connected to the server' }
        : {
            label: 'Online',
            mark: 'fail',
            detail: !live
              ? 'the agent is not responding'
              : live.version === null
                ? 'unknown (an older version is running; restart it)'
                : 'not connected (retrying)',
            fix: restartFix,
            hint: `Log: ${logFile(ctx.home)}`,
          },
    );
  }

  const hooksOk = await hooksCurrent(ctx);
  const st = await hooksStatus(defaultSettingsPath());
  checks.push(
    hooksOk
      ? { label: 'Claude Code link', mark: 'ok', detail: 'set up' }
      : {
          label: 'Claude Code link',
          mark: 'warn',
          detail: st.installed ? 'outdated or pointing elsewhere' : 'not set up',
          ...(stableInstall(ctx)
            ? { fix: async () => ((await ensureHooks(ctx)).changed ? 'set up' : 'already set up') }
            : {}),
        },
  );

  if (autostartSupported()) {
    const current = await autostartCurrent(ctx);
    checks.push(
      current
        ? { label: 'Start at sign-in', mark: 'ok', detail: 'on' }
        : {
            label: 'Start at sign-in',
            mark: 'warn',
            detail: (await autostartCommandRegistered()) ? 'points to an old install' : 'off',
            ...(stableInstall(ctx) && paired
              ? { fix: async () => ((await ensureAutostart(ctx)) === 'enabled' ? 'turned on' : 'already on') }
              : {}),
          },
    );
  }

  const policy = await loadPolicy(ctx.home);
  const missing = await missingWorkspaces(ctx.home);
  checks.push(
    missing.length
      ? {
          label: 'Workspaces',
          mark: 'warn',
          detail: `${missing.length} folder(s) no longer exist`,
          hint: missing.map((m) => `pocket-agent projects remove "${m}"`).join('\n'),
        }
      : policy.projects.length
        ? { label: 'Workspaces', mark: 'ok', detail: `${policy.projects.length} allowed` }
        : { label: 'Workspaces', mark: 'info', detail: 'none (pocket-agent projects add <folder>)' },
    {
      label: 'Phone approvals',
      mark: policy.remoteApproval ? 'ok' : 'info',
      detail: policy.remoteApproval ? 'on' : 'off (pocket-agent approvals enable)',
    },
  );
  return checks;
}

export function buildCli(): Command {
  const program = new Command('pocket-agent')
    .description('Pocket Agent Local Agent: connect this PC to your Pocket Agent dashboard.')
    .version(version, '-v, --version')
    .commandsGroup('Advanced:');

  program
    .command('connect')
    .helpGroup('Commands:')
    .alias('setup')
    .description('Connect this PC to Pocket Agent: everything in one step (safe to run again)')
    .argument('[code]', 'pairing code from the app (Add device); not needed to repair an existing setup')
    .option('--api <url>', 'Pocket Agent server (default: the hosted one)')
    .option('--name <name>', 'name shown in the app', os.hostname())
    .option('--workspace <folders...>', 'folders where your phone may start Claude sessions')
    .option('--approvals', 'answer permission requests from your phone')
    .option('-y, --yes', "don't ask questions; keep defaults")
    .option('--no-hooks', "don't connect Claude Code sessions you start yourself")
    .option('--no-autostart', "don't start at sign-in")
    .action((code: string | undefined, opts: ConnectOptions) => connectThisPc(code, opts));

  program
    .command('status')
    .helpGroup('Commands:')
    .description('Is this PC connected? Pairing, background service and connection at a glance')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      const home = agentHome();
      const config = await loadConfig(home);
      if (opts.json) {
        const pid = await runningPid(home);
        const live = pid ? await liveStatus(home) : null;
        return console.log(
          JSON.stringify({
            version,
            protocolVersion: PROTOCOL_VERSION,
            home,
            paired: !!config && !config.revokedAt,
            revoked: !!config?.revokedAt,
            apiUrl: config?.apiUrl ?? null,
            deviceId: config?.deviceId ?? null,
            deviceName: config?.deviceName ?? null,
            running: !!pid,
            online: !!live?.connected,
          }),
        );
      }
      heading(`Pocket Agent ${version}`);
      const checks = await runChecks(false);
      for (const c of checks) line(c.mark, c.label, c.detail);
      const online = checks.find((c) => c.label === 'Online')?.mark === 'ok';
      console.log(
        online
          ? `\n${green('This PC is online.')} ${dim(config ? `Server: ${new URL(config.apiUrl).host}` : '')}`
          : `\n${red('This PC is not online.')} Run ${bold('pocket-agent doctor')} to find out why.`,
      );
    });

  program
    .command('doctor')
    .helpGroup('Commands:')
    .description('Check every part of the setup and explain what is wrong')
    .option('--fix', 'repair what can be repaired safely')
    .action(async (opts: { fix?: boolean }) => {
      heading('Pocket Agent doctor');
      const checks = await runChecks(true);
      for (const c of checks) line(c.mark, c.label, c.detail);
      const broken = checks.filter((c) => c.mark === 'fail' || c.mark === 'warn');
      if (!broken.length) return void console.log(`\n${green('Everything looks good.')}`);
      const fixable = broken.filter((c) => c.fix);
      if (opts.fix && fixable.length) {
        heading('Repairing');
        for (const c of fixable) {
          try {
            line('ok', c.label, await c.fix!());
          } catch (e) {
            line('fail', c.label, (e as Error).message);
          }
        }
      }
      const todo = opts.fix ? broken.filter((c) => !c.fix) : broken;
      const hints = todo.filter((c) => c.hint);
      if (hints.length) {
        heading('What to do');
        for (const c of hints) console.log(`  ${bold(c.label)}: ${c.hint!.split('\n').join('\n    ')}`);
      }
      if (!opts.fix && fixable.length) {
        console.log(
          `\nRun ${bold('pocket-agent doctor --fix')} to repair ${fixable.map((c) => c.label).join(', ')}.`,
        );
      }
      process.exitCode = 1;
    });

  program
    .command('disconnect')
    .helpGroup('Commands:')
    .description(
      'Disconnect this PC: stop Pocket Agent, remove the Claude Code link, start-at-sign-in and credentials',
    )
    .option('-y, --yes', "don't ask for confirmation")
    .action(async (opts: { yes?: boolean }) => {
      if (!opts.yes && !(await confirm('Disconnect this PC from Pocket Agent?', false))) return;
      await disconnectThisPc();
      console.log(`\n${green('Disconnected.')} Remove this PC under Devices in the app as well.`);
    });

  program
    .command('update')
    .helpGroup('Commands:')
    .description('Update Pocket Agent to the latest version and restart it')
    .action(async () => {
      requireStableInstall('Updating');
      console.log(`Updating ${PACKAGE_NAME}…`);
      const code = await npmGlobal(['install', '-g', `${PACKAGE_NAME}@latest`]);
      if (code !== 0) fail(`npm exited with code ${code}. Try: npm install -g ${PACKAGE_NAME}@latest`);
      const home = agentHome();
      if (await runningPid(home)) {
        // Same install path, new files: a restart runs the new version.
        await ensureRunning(setupContext(), true);
        const online = await withSpinner('Reconnecting…', () => waitOnline(home, 45_000));
        console.log(
          online.ok ? 'Updated and reconnected.' : 'Updated. Not connected yet: run pocket-agent doctor',
        );
      } else console.log('Updated.');
    });

  program
    .command('uninstall')
    .helpGroup('Commands:')
    .description('Disconnect this PC and remove Pocket Agent and all its data')
    .option('-y, --yes', "don't ask for confirmation")
    .action(async (opts: { yes?: boolean }) => {
      if (!opts.yes && !(await confirm('Remove Pocket Agent and all its data from this PC?', false))) return;
      await disconnectThisPc();
      await rm(agentHome(), { recursive: true, force: true }).catch(() => undefined);
      line('ok', 'Data', `removed ${agentHome()}`);
      const code = await npmGlobal(['uninstall', '-g', PACKAGE_NAME]);
      if (code === 0) line('ok', 'Program', 'uninstalled');
      else line('warn', 'Program', `npm failed; remove it with: npm uninstall -g ${PACKAGE_NAME}`);
      console.log(`\n${green('Pocket Agent was removed.')} Remove this PC under Devices in the app as well.`);
    });

  program
    .command('pair')
    .description('Pair this PC using the code shown in the dashboard (Devices → Add device)')
    .argument('<code>', 'pairing code, e.g. 7KQ2-M9XD')
    .option('--api <url>', 'Pocket Agent API URL', process.env['POCKET_AGENT_API_URL'] ?? DEFAULT_API_URL)
    .option('--name <name>', 'name shown in the dashboard', os.hostname())
    .action(async (code: string, opts: { api: string; name: string }) => {
      await pairThisPc(code, opts.api, opts.name);
      console.log(`Paired as "${opts.name}". Start the agent with: pocket-agent start`);
    });

  program
    .command('start')
    .description('Connect to Pocket Agent and report Claude Code sessions')
    .option('--background', 'run without a terminal window (output goes to agent.log)')
    .action(async (opts: { background?: boolean }) => {
      if (opts.background) return startInBackground();
      const home = agentHome();
      const { config, secret } = await requirePaired(home);
      const other = await runningPid(home);
      if (other) fail(`Pocket Agent is already running (PID ${other}). Stop it with: pocket-agent stop`);
      await writePidFile(home);
      process.on('exit', () => clearPidFileSync(home));
      // Load the SDK only when the agent actually runs.
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const service = new AgentService({
        home,
        apiUrl: config.apiUrl,
        deviceId: config.deviceId,
        secret,
        agentVersion: version,
        platform: currentPlatform(),
        query: query as unknown as QueryFn,
        log,
      });
      const link = service.link;
      link.on('log', log);
      link.on('connected', () =>
        log('info', `Connected to ${new URL(config.apiUrl).origin} as "${config.deviceName}"`),
      );
      link.on('disconnected', (code, willRetry, ms) =>
        log(
          'warn',
          `Disconnected (code ${code})${willRetry ? `; reconnecting in ${(ms / 1000).toFixed(1)}s` : ''}`,
        ),
      );
      link.on('stopped', async (reason) => {
        await service.stop().catch(() => undefined);
        if (reason === 'revoked') {
          // Credentials are dead: remove them and remember why.
          await createSecretStore(home).clear();
          await saveConfig(home, { ...config, revokedAt: new Date().toISOString() });
          log(
            'error',
            'This device was revoked from the dashboard. Credentials removed. Pair again to reconnect.',
          );
          process.exit(3);
        }
        if (reason === 'unauthorized') {
          log(
            'error',
            "The server rejected this device's credentials. Pair again: pocket-agent pair <code> --api <url>",
          );
          process.exit(4);
        }
        if (reason === 'replaced') {
          log('error', 'Another Pocket Agent agent process connected as this device; this one is stopping.');
          process.exit(5);
        }
        process.exit(0);
      });
      let stopping = false;
      const shutdown = () => {
        if (stopping) return;
        stopping = true;
        log('info', 'Stopping…');
        void service.stop();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      log('info', `Pocket Agent Local Agent ${version} starting`);
      await service.start();
      if (!service.hooksAreInstalled) {
        log(
          'warn',
          'Claude Code hooks are not installed: sessions you start yourself show coarse status only. ' +
            'Run: pocket-agent hooks install',
        );
      }
    });

  program
    .command('stop')
    .description('Stop the Pocket Agent running on this PC')
    .action(async () => {
      try {
        const stopped = await stopRunning(agentHome());
        console.log(stopped ? 'Pocket Agent stopped.' : 'Pocket Agent is not running.');
      } catch (e) {
        fail((e as Error).message);
      }
    });

  const autostart = program
    .command('autostart')
    .description('Start Pocket Agent automatically when you sign in to Windows');
  autostart.command('enable').action(async () => {
    try {
      await enableStartAtSignIn();
    } catch (e) {
      fail((e as Error).message);
    }
  });
  autostart.command('disable').action(async () => {
    try {
      console.log(
        (await disableAutostart()) ? 'Start at sign-in turned off.' : 'Start at sign-in was already off.',
      );
    } catch (e) {
      fail((e as Error).message);
    }
  });
  autostart.command('status').action(async () => {
    if (!autostartSupported()) return void console.log('Start at sign-in: not supported on this OS yet');
    const cmd = await autostartCommandRegistered();
    console.log(cmd ? `Start at sign-in: on\n  ${cmd}` : 'Start at sign-in: off');
  });

  program
    .command('rotate')
    .description("Replace this device's secret with a new one")
    .action(async () => {
      const home = agentHome();
      const { config, secret } = await requirePaired(home);
      try {
        const next = await rotateSecret(config.apiUrl, config.deviceId, secret);
        // Save first: the server keeps the old secret valid until the new one is used once.
        await createSecretStore(home).save(next);
        await confirmSecret(config.apiUrl, config.deviceId, next);
        console.log('Device secret rotated. The previous secret no longer works.');
      } catch (e) {
        fail(e instanceof ApiRequestError ? e.message : (e as Error).message);
      }
    });

  program
    .command('unpair')
    .description("Forget this PC's credentials locally (revoke it in the dashboard too)")
    .action(async () => {
      const home = agentHome();
      await createSecretStore(home).clear();
      await deleteConfig(home);
      console.log('Local credentials removed. Also revoke this device under Devices in the dashboard.');
    });

  // ── What remote users may do on this PC (enforced here) ─────────────────────
  /** Tells a running agent to pick up policy changes; fine if it isn't running. */
  const reloadAgent = async () => {
    try {
      await callLocalAgent(agentHome(), 'POST', '/policy/reload');
      console.log('The running agent picked up the change.');
    } catch {
      console.log('Takes effect the next time the agent starts.');
    }
  };

  const projects = program
    .command('projects')
    .description('Folders where managed sessions may be started from the dashboard');

  projects
    .command('add')
    .argument('<dir>', 'project folder')
    .option('--name <name>', 'name shown in the dashboard')
    .action(async (dir: string, opts: { name?: string }) => {
      const full = path.resolve(dir);
      const st = await stat(full).catch(() => null);
      if (!st?.isDirectory()) fail(`Not a folder: ${full}`);
      const home = agentHome();
      const policy = await loadPolicy(home);
      if (isAllowedProject(policy, full)) return console.log(`Already allowed: ${full}`);
      if (policy.projects.length >= 50) fail('At most 50 projects.');
      policy.projects.push({ name: (opts.name ?? path.basename(full)).slice(0, 200), path: full });
      await savePolicy(home, policy);
      console.log(`Allowed: ${full}`);
      await reloadAgent();
    });

  projects
    .command('remove')
    .argument('<dir>', 'project folder')
    .action(async (dir: string) => {
      const home = agentHome();
      const policy = await loadPolicy(home);
      const target = normalizeProjectPath(dir);
      const next = policy.projects.filter((p) => normalizeProjectPath(p.path) !== target);
      if (next.length === policy.projects.length) return console.log('That folder was not on the list.');
      await savePolicy(home, { ...policy, projects: next });
      console.log(`Removed: ${path.resolve(dir)}`);
      await reloadAgent();
    });

  projects.command('list').action(async () => {
    const { projects: list } = await loadPolicy(agentHome());
    if (!list.length) return console.log('No projects. Add one with: pocket-agent projects add <folder>');
    for (const p of list) console.log(`${p.name.padEnd(24)} ${p.path}`);
  });

  const instructions = program
    .command('instructions')
    .description('Instructions to Claude Code sessions you start yourself (VS Code, terminal)');
  const setInstructions = async (on: boolean) => {
    const home = agentHome();
    await savePolicy(home, { ...(await loadPolicy(home)), observedInstructions: on });
    console.log(
      on
        ? 'Enabled. Sessions with Pocket Agent hooks can receive instructions from the dashboard; each one is delivered when Claude finishes its current turn. Claude Code still asks you for every permission.'
        : 'Disabled. Only managed sessions can receive instructions.',
    );
    await reloadAgent();
  };
  const attachments = program
    .command('attachments')
    .description('Show photos and PDFs you attach to prompts in your editor in the Pocket Agent chat');
  const setAttachments = async (on: boolean) => {
    const home = agentHome();
    await savePolicy(home, { ...(await loadPolicy(home)), shareAttachments: on });
    console.log(
      on
        ? 'On. Photos and PDFs you attach to a prompt in your editor are uploaded to your Pocket Agent account so the chat can show them. Files are deleted after 30 days; a small preview stays. Files sent to you from the app are always downloaded to this PC.'
        : 'Off. Files you attach in your editor stay on this PC.',
    );
    await reloadAgent();
  };
  attachments.command('enable').action(() => setAttachments(true));
  attachments.command('disable').action(() => setAttachments(false));
  attachments.command('status').action(async () => {
    console.log((await loadPolicy(agentHome())).shareAttachments ? 'Enabled' : 'Disabled (default)');
  });

  instructions.command('enable').action(() => setInstructions(true));
  instructions.command('disable').action(() => setInstructions(false));
  instructions.command('status').action(async () => {
    const { observedInstructions, wakeIdle } = await loadPolicy(agentHome());
    console.log(observedInstructions ? 'Enabled' : 'Disabled (default)');
    console.log(`Wake idle sessions: ${observedInstructions && wakeIdle ? 'on' : 'off (default)'}`);
  });

  const wake = instructions
    .command('wake')
    .description('Run an instruction at once when the session is idle, instead of after your next turn');
  const setWake = async (on: boolean) => {
    const home = agentHome();
    const policy = await loadPolicy(home);
    // Waking only makes sense with instructions allowed; enabling it allows both (explicit consent).
    await savePolicy(home, { ...policy, wakeIdle: on, ...(on ? { observedInstructions: true } : {}) });
    console.log(
      on
        ? 'On. When a session you started is idle, an instruction from the dashboard runs right away: Pocket Agent resumes that session on this PC (same conversation) for one turn. Your Claude Code permission rules apply; anything that would ask you is sent to Pocket Agent if remote approval is on, otherwise denied. Your editor does not show these turns live; the next prompt you type there gets a summary of them.'
        : 'Off. Instructions to an idle session wait until you finish a turn on the PC.',
    );
    await reloadAgent();
  };
  wake.command('enable').action(() => setWake(true));
  wake.command('disable').action(() => setWake(false));

  const approvals = program
    .command('approvals')
    .description('Answer Claude Code permission requests from the dashboard (off by default)');
  const setApprovals = async (on: boolean) => {
    const home = agentHome();
    await savePolicy(home, { ...(await loadPolicy(home)), remoteApproval: on });
    if (on) {
      console.log('Enabled.');
      console.log(
        '- Managed sessions: permission requests wait for your decision in the dashboard (denied after 10 min).',
      );
      console.log(
        '- Sessions you start yourself: only while Away mode is on (switch it in the dashboard, under Devices).',
      );
      console.log(
        '  Otherwise Claude Code asks on this PC as usual. Unanswered requests fall back to the PC after 5 min.',
      );
      const st = await hooksStatus(defaultSettingsPath());
      if (st.installed && (st.permissionTimeoutS ?? 0) < PERMISSION_HOOK_TIMEOUT_S) {
        console.log('');
        console.log(
          'Your installed hooks are from an older version. Update them with: pocket-agent hooks install',
        );
      }
    } else {
      console.log('Disabled. Permission requests are answered on this PC only (managed sessions: denied).');
    }
    await reloadAgent();
  };
  approvals.command('enable').action(() => setApprovals(true));
  approvals.command('disable').action(() => setApprovals(false));
  approvals.command('status').action(async () => {
    const { remoteApproval } = await loadPolicy(agentHome());
    console.log(remoteApproval ? 'Enabled' : 'Disabled (default)');
  });

  // ── Claude Code integration ────────────────────────────────────────────────
  const hooks = program
    .command('hooks')
    .description('Connect Claude Code sessions you start yourself (VS Code, terminal)');
  const settingsHelp = 'Claude Code settings file (default: ~/.claude/settings.json)';

  hooks
    .command('install')
    .description('Add Pocket Agent observe-only hooks to Claude Code settings (backs the file up first)')
    .option('--settings <file>', settingsHelp)
    .action(async (opts: { settings?: string }) => {
      requireStableInstall('Installing hooks');
      await installClaudeHooks(opts.settings);
    });

  hooks
    .command('uninstall')
    .helpGroup('Commands:')
    .description('Remove Pocket Agent hooks (other hooks are left untouched)')
    .option('--settings <file>', settingsHelp)
    .action(async (opts: { settings?: string }) => {
      try {
        const r = await uninstallHooks(opts.settings ?? defaultSettingsPath());
        console.log(
          r.removed
            ? `Removed ${r.removed} Pocket Agent hook entries.`
            : 'No Pocket Agent hooks were installed.',
        );
      } catch (e) {
        fail((e as Error).message);
      }
    });

  hooks
    .command('status')
    .helpGroup('Commands:')
    .description('Show whether Pocket Agent hooks are installed')
    .option('--settings <file>', settingsHelp)
    .action(async (opts: { settings?: string }) => {
      const file = opts.settings ?? defaultSettingsPath();
      const st = await hooksStatus(file);
      console.log(
        st.installed ? `Installed in ${file} (${st.events.length} events)` : `Not installed in ${file}`,
      );
    });

  program
    .command('run')
    .description('Start a managed Claude Code session on this PC (the agent must be running)')
    .argument('<prompt...>', 'first instruction for Claude')
    .option('--cwd <dir>', 'project directory', process.cwd())
    .option('--model <model>', 'Claude model (defaults to your Claude Code setting)')
    .action(async (words: string[], opts: { cwd: string; model?: string }) => {
      try {
        const r = await callLocalAgent(agentHome(), 'POST', '/sessions', {
          projectPath: path.resolve(opts.cwd),
          prompt: words.join(' '),
          ...(opts.model ? { model: opts.model } : {}),
        });
        if (r.status !== 201) fail((r.body as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
        console.log(`Started managed session ${(r.body as { externalSessionId: string }).externalSessionId}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  program
    .command('sessions')
    .description('List the Claude Code sessions the running agent knows about')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      try {
        const r = await callLocalAgent(agentHome(), 'GET', '/sessions');
        const list = r.body as Array<{
          externalSessionId: string;
          mode: string;
          status: string;
          projectPath: string;
        }>;
        if (opts.json) return console.log(JSON.stringify(list));
        if (!list.length) return console.log('No live sessions.');
        for (const x of list) {
          console.log(`${x.externalSessionId}  ${x.mode.padEnd(8)} ${x.status.padEnd(20)} ${x.projectPath}`);
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  program
    .command('stop-session')
    .description('Stop a managed session')
    .argument('<id>', 'session id from `pocket-agent sessions`')
    .action(async (id: string) => {
      try {
        const r = await callLocalAgent(agentHome(), 'POST', `/sessions/${encodeURIComponent(id)}/stop`);
        if (r.status === 404) fail('No managed session with that id (only managed sessions can be stopped).');
        console.log('Stopped.');
      } catch (e) {
        fail((e as Error).message);
      }
    });

  return program;
}

await buildCli().parseAsync();
