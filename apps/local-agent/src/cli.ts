#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PROTOCOL_VERSION } from '@agentdock/protocol';
import { agentHome } from './paths.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export function buildCli(): Command {
  const program = new Command('agentdock')
    .description('AgentDock Local Agent: connect this PC to your AgentDock dashboard.')
    .version(version, '-v, --version');

  program
    .command('status')
    .description('Show local agent configuration and pairing state')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      const home = agentHome();
      const status = {
        version,
        protocolVersion: PROTOCOL_VERSION,
        home,
        paired: existsSync(path.join(home, 'device.json')),
      };
      if (opts.json) console.log(JSON.stringify(status));
      else {
        console.log(`AgentDock Local Agent ${status.version} (protocol v${status.protocolVersion})`);
        console.log(`State directory: ${status.home}`);
        console.log(`Paired: ${status.paired ? 'yes' : 'no (device pairing arrives in M2)'}`);
      }
    });

  return program;
}

buildCli().parse();
