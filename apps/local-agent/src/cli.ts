#!/usr/bin/env node
import { PROTOCOL_VERSION } from '@agentdock/protocol';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiRequestError, confirmSecret, pairDevice, rotateSecret } from './api-client.js';
import { currentPlatform, deleteConfig, loadConfig, saveConfig, validateApiUrl } from './config.js';
import { callLocalAgent } from './local-client.js';
import { agentHome } from './paths.js';
import {
  defaultSettingsPath,
  hooksStatus,
  installHooks,
  relayCommand,
  uninstallHooks,
} from './providers/claude-code/install.js';
import type { QueryFn } from './providers/claude-code/managed.js';
import { createSecretStore } from './secret-store.js';
import { AgentService } from './service.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

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
  if (!config) fail('This PC is not paired. Run: agentdock pair <code> --api <url>');
  if (config.revokedAt)
    fail('This device was revoked. Pair it again with a new code: agentdock pair <code> --api <url>');
  const secret = await createSecretStore(home).load();
  if (!secret) fail('Device credentials are missing. Pair again: agentdock pair <code> --api <url>');
  return { config, secret };
}

export function buildCli(): Command {
  const program = new Command('agentdock')
    .description('AgentDock Local Agent: connect this PC to your AgentDock dashboard.')
    .version(version, '-v, --version');

  program
    .command('pair')
    .description('Pair this PC using the code shown in the dashboard (Devices → Add device)')
    .argument('<code>', 'pairing code, e.g. 7KQ2-M9XD')
    .option('--api <url>', 'AgentDock API URL', process.env['AGENTDOCK_API_URL'])
    .option('--name <name>', 'name shown in the dashboard', os.hostname())
    .action(async (code: string, opts: { api?: string; name: string }) => {
      if (!opts.api) fail('Missing --api <url> (or set AGENTDOCK_API_URL)');
      try {
        validateApiUrl(opts.api);
      } catch (e) {
        fail((e as Error).message);
      }
      const home = agentHome();
      try {
        const res = await pairDevice(opts.api, {
          code,
          name: opts.name.slice(0, 100),
          platform: currentPlatform(),
          agentVersion: version,
        });
        await saveConfig(home, {
          apiUrl: opts.api,
          deviceId: res.deviceId,
          deviceName: opts.name,
          pairedAt: new Date().toISOString(),
        });
        await createSecretStore(home).save(res.deviceSecret);
        console.log(`Paired as "${opts.name}". Start the agent with: agentdock start`);
      } catch (e) {
        fail(e instanceof ApiRequestError ? e.message : `Pairing failed: ${(e as Error).message}`);
      }
    });

  program
    .command('start')
    .description('Connect to AgentDock and report Claude Code sessions (foreground)')
    .action(async () => {
      const home = agentHome();
      const { config, secret } = await requirePaired(home);
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
            "The server rejected this device's credentials. Pair again: agentdock pair <code> --api <url>",
          );
          process.exit(4);
        }
        if (reason === 'replaced') {
          log('error', 'Another AgentDock agent process connected as this device; this one is stopping.');
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
      log('info', `AgentDock Local Agent ${version} starting`);
      await service.start();
      if (!service.hooksAreInstalled) {
        log(
          'warn',
          'Claude Code hooks are not installed: sessions you start yourself show coarse status only. ' +
            'Run: agentdock hooks install',
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
      console.log(`AgentDock Local Agent ${status.version} (protocol v${status.protocolVersion})`);
      console.log(`State directory: ${status.home}`);
      if (status.revoked) console.log('Paired: no (this device was revoked; pair again)');
      else if (!status.paired) console.log('Paired: no (run: agentdock pair <code> --api <url>)');
      else console.log(`Paired: yes, as "${status.deviceName}" with ${status.apiUrl}`);
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

  // ── Claude Code integration ────────────────────────────────────────────────
  const hooks = program
    .command('hooks')
    .description('Connect Claude Code sessions you start yourself (VS Code, terminal)');
  const settingsHelp = 'Claude Code settings file (default: ~/.claude/settings.json)';

  hooks
    .command('install')
    .description('Add AgentDock observe-only hooks to Claude Code settings (backs the file up first)')
    .option('--settings <file>', settingsHelp)
    .action(async (opts: { settings?: string }) => {
      const relay = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook-relay.js');
      if (!existsSync(relay)) fail(`Hook relay not found at ${relay}. Build the agent first.`);
      try {
        const r = await installHooks(
          opts.settings ?? defaultSettingsPath(),
          relayCommand(process.execPath, relay, agentHome()),
        );
        console.log(`Installed AgentDock hooks in ${r.settingsPath}`);
        if (r.backupPath) console.log(`Backup of the previous file: ${r.backupPath}`);
        console.log('The hooks only report activity; they never answer permission prompts.');
        console.log('Sessions that are already running pick this up after a restart.');
      } catch (e) {
        fail((e as Error).message);
      }
    });

  hooks
    .command('uninstall')
    .description('Remove AgentDock hooks (other hooks are left untouched)')
    .option('--settings <file>', settingsHelp)
    .action(async (opts: { settings?: string }) => {
      try {
        const r = await uninstallHooks(opts.settings ?? defaultSettingsPath());
        console.log(
          r.removed ? `Removed ${r.removed} AgentDock hook entries.` : 'No AgentDock hooks were installed.',
        );
      } catch (e) {
        fail((e as Error).message);
      }
    });

  hooks
    .command('status')
    .description('Show whether AgentDock hooks are installed')
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
    .argument('<id>', 'session id from `agentdock sessions`')
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
