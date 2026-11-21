#!/usr/bin/env node
import { PROTOCOL_VERSION } from '@pocket-agent/protocol';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
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
import { currentPlatform, deleteConfig, loadConfig, saveConfig, validateApiUrl } from './config.js';
import { callLocalAgent } from './local-client.js';
import { agentHome } from './paths.js';
import { isAllowedProject, loadPolicy, normalizeProjectPath, savePolicy } from './policy.js';
import {
  defaultSettingsPath,
  hooksStatus,
  installHooks,
  PERMISSION_HOOK_TIMEOUT_S,
  relayCommand,
  uninstallHooks,
} from './providers/claude-code/install.js';
import type { QueryFn } from './providers/claude-code/managed.js';
import { createSecretStore } from './secret-store.js';
import { AgentService } from './service.js';

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

async function requirePaired(home: string) {
  const config = await loadConfig(home);
  if (!config) fail('This PC is not paired. Run: pocket-agent pair <code> --api <url>');
  if (config.revokedAt)
    fail('This device was revoked. Pair it again with a new code: pocket-agent pair <code> --api <url>');
  const secret = await createSecretStore(home).load();
  if (!secret) fail('Device credentials are missing. Pair again: pocket-agent pair <code> --api <url>');
  return { config, secret };
}

async function pairThisPc(code: string, apiUrl: string | undefined, name: string): Promise<void> {
  if (!apiUrl) fail('Missing --api <url> (or set POCKET_AGENT_API_URL)');
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
  try {
    const r = await installHooks(
      settings ?? defaultSettingsPath(),
      relayCommand(process.execPath, RELAY_PATH, agentHome()),
    );
    console.log(`Installed Pocket Agent hooks in ${r.settingsPath}`);
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

export function buildCli(): Command {
  const program = new Command('pocket-agent')
    .description('Pocket Agent Local Agent: connect this PC to your Pocket Agent dashboard.')
    .version(version, '-v, --version');

  program
    .command('pair')
    .description('Pair this PC using the code shown in the dashboard (Devices → Add device)')
    .argument('<code>', 'pairing code, e.g. 7KQ2-M9XD')
    .option('--api <url>', 'Pocket Agent API URL', process.env['POCKET_AGENT_API_URL'])
    .option('--name <name>', 'name shown in the dashboard', os.hostname())
    .action(async (code: string, opts: { api?: string; name: string }) => {
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
    .command('status')
    .description('Show local agent configuration and pairing state')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      const home = agentHome();
      const config = await loadConfig(home);
      const status = {
        version,
        protocolVersion: PROTOCOL_VERSION,
        home,
        paired: !!config && !config.revokedAt,
        revoked: !!config?.revokedAt,
        apiUrl: config?.apiUrl ?? null,
        deviceId: config?.deviceId ?? null,
        deviceName: config?.deviceName ?? null,
      };
      if (opts.json) return console.log(JSON.stringify(status));
      console.log(`Pocket Agent Local Agent ${status.version} (protocol v${status.protocolVersion})`);
      console.log(`State directory: ${status.home}`);
      if (status.revoked) console.log('Paired: no (this device was revoked; pair again)');
      else if (!status.paired) console.log('Paired: no (run: pocket-agent pair <code> --api <url>)');
      else console.log(`Paired: yes, as "${status.deviceName}" with ${status.apiUrl}`);
      const pid = await runningPid(home);
      console.log(
        pid ? `Running: yes (PID ${pid})` : 'Running: no (start with: pocket-agent start --background)',
      );
      if (autostartSupported()) {
        console.log(`Start at sign-in: ${(await autostartCommandRegistered()) ? 'on' : 'off'}`);
      }
    });

  program
    .command('setup')
    .description('One step: pair this PC, connect Claude Code, start now and at every sign-in')
    .argument('<code>', 'pairing code from the dashboard (Devices → Add device)')
    .option('--api <url>', 'Pocket Agent API URL', process.env['POCKET_AGENT_API_URL'])
    .option('--name <name>', 'name shown in the dashboard', os.hostname())
    .option('--no-hooks', "don't connect Claude Code sessions you start yourself")
    .option('--no-autostart', "don't start at sign-in")
    .action(
      async (code: string, opts: { api?: string; name: string; hooks: boolean; autostart: boolean }) => {
        requireStableInstall('Setup');
        const home = agentHome();
        // Re-pairing while an old agent runs would leave it on stale credentials.
        if (await stopRunning(home).catch(() => false)) console.log('Stopped the running agent.');
        await pairThisPc(code, opts.api, opts.name);
        console.log(`Paired as "${opts.name}".`);
        if (opts.hooks) await installClaudeHooks();
        if (opts.autostart) await enableStartAtSignIn();
        await startInBackground();
        console.log('Done. Open the dashboard: this PC should show as Online.');
      },
    );

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
