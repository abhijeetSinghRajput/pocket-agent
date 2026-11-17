// Creates a migration from the diff between the dev database and prisma/schema.prisma, without the
// interactive `prisma migrate dev` prompt. Usage: pnpm db:new <name>   (then: pnpm db:deploy)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('usage: pnpm db:new <snake_case_name>');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const dir = path.join('prisma', 'migrations', `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'migration.sql');
execFileSync(
  'pnpm',
  [
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
    '-o',
    file,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
if (!readFileSync(file, 'utf8').replace(/--.*$/gm, '').trim()) {
  rmSync(dir, { recursive: true });
  console.log('No schema changes; nothing created.');
} else console.log(`Created ${file}. Review it, then run: pnpm db:deploy`);
