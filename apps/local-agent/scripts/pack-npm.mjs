// Builds the publishable npm package for the Local Agent into apps/local-agent/npm/.
// The workspace packages (protocol) and small deps are bundled; the Claude Agent SDK stays a real
// dependency (it ships a platform-specific Claude Code binary).
//
//   node scripts/pack-npm.mjs [--name <npm-package-name>]
//   cd npm && npm pack            # inspect the tarball
//   cd npm && npm publish --access public
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'npm');
const args = process.argv.slice(2);
const nameArg = args.indexOf('--name');
const name = nameArg >= 0 ? args[nameArg + 1] : (process.env.POCKET_AGENT_NPM_NAME ?? 'pocketagent');

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const SDK = '@anthropic-ai/claude-agent-sdk';

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'dist'), { recursive: true });

await build({
  entryPoints: {
    cli: path.join(root, 'src/cli.ts'),
    'hook-relay': path.join(root, 'src/hook-relay.ts'),
  },
  outdir: path.join(out, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: [SDK],
  // CommonJS deps (ws, commander) call require() for Node built-ins; give the ESM bundle one.
  banner: {
    js: "import { createRequire as __pocketAgentRequire } from 'node:module';\nconst require = __pocketAgentRequire(import.meta.url);",
  },
  legalComments: 'linked',
  logLevel: 'warning',
});

const published = {
  name,
  version: pkg.version,
  description: 'Pocket Agent for your PC: control your Claude Code sessions from your phone.',
  type: 'module',
  bin: { 'pocket-agent': 'dist/cli.js' },
  files: ['dist', 'README.md'],
  engines: { node: pkg.engines?.node ?? '>=24.7' },
  os: ['win32', 'darwin', 'linux'],
  dependencies: { [SDK]: pkg.dependencies[SDK] },
  keywords: ['claude', 'claude-code', 'agent', 'remote', 'pocket-agent'],
  license: 'UNLICENSED',
};
await writeFile(path.join(out, 'package.json'), JSON.stringify(published, null, 2) + '\n');
await writeFile(
  path.join(out, 'README.md'),
  `# Pocket Agent (PC agent)

Connects this PC to your Pocket Agent dashboard so you can watch and control your Claude Code
sessions from your phone.

\`\`\`bash
npm install -g ${name}
pocket-agent setup <CODE> --api <YOUR-API-URL>
\`\`\`

Get the code and the exact command from the dashboard: **Devices → Add device**. \`setup\` pairs
this PC, connects Claude Code, starts the agent in the background and (on Windows) at every
sign-in.

Other commands: \`pocket-agent status\`, \`stop\`, \`start --background\`, \`autostart disable\`,
\`hooks uninstall\`, \`unpair\`. Requires Node.js ${published.engines.node}.

Remote approval and instructions to sessions you started yourself are **off by default**; turn
them on with \`pocket-agent approvals enable\` / \`pocket-agent instructions enable\`.
`,
);
console.log(`Built ${name}@${pkg.version} in ${path.relative(process.cwd(), out) || '.'}`);
