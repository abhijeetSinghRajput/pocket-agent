#!/usr/bin/env node
import { PROTOCOL_VERSION } from '@agentdock/protocol';
import { Command } from 'commander';
import { createRequire } from 'node:module';
import os from 'node:os';
import { ApiRequestError, confirmSecret, pairDevice, rotateSecret } from './api-client.js';
import { currentPlatform, deleteConfig, loadConfig, saveConfig, validateApiUrl } from './config.js';
import { AgentLink } from './link.js';
import { agentHome } from './paths.js';
import { createSecretStore } from './secret-store.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

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
        const store = createSecretStore(home);
        await saveConfig(home, {
          apiUrl: opts.api,
          deviceId: res.deviceId,
          deviceName: opts.name,
          pairedAt: new Date().toISOString(),
        });
        await store.save(res.deviceSecret);
        console.log(`Paired as "${opts.name}". Start the agent with: agentdock start`);
      } catch (e) {
        fail(e instanceof ApiRequestError ? e.message : `Pairing failed: ${(e as Error).message}`);
      }
    });

  program
    .command('start')
    .description('Connect to AgentDock and stay online (foreground)')
    .action(async () => {
      const home = agentHome();
      const { config, secret } = await requirePaired(home);
      const link = new AgentLink({
        apiUrl: config.apiUrl,
        deviceId: config.deviceId,
        secret,
        agentVersion: version,
        platform: currentPlatform(),
      });
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
      const shutdown = () => {
        log('info', 'Stopping…');
        link.stop();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      log('info', `AgentDock Local Agent ${version} starting`);
      link.start();
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

  return program;
}

await buildCli().parseAsync();
