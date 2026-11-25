#!/usr/bin/env node
// Prompt-cache report for Claude Code conversations on this PC, from the API's own usage numbers
// (Claude Code saves them with every reply in the conversation's transcript).
//
//   node apps/local-agent/scripts/cache-report.mjs <session-id> [<session-id> …]
//   node apps/local-agent/scripts/cache-report.mjs --recent 5      (the 5 newest conversations)
//
// For each conversation: every API call's cache writes, cache reads and uncached input; the
// calls that missed the cache; and each switch between VS Code / terminal and Pocket Agent
// (a woken or phone-started turn), with the time since the previous call. Reads only; nothing
// is sent anywhere.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
/** A call that wrote more than this to the cache (and read under 90% of its context) missed it. */
const MISS_WRITE = 10_000;

const SOURCE = { 'claude-vscode': 'VS Code', cli: 'terminal', 'sdk-ts': 'Pocket Agent' };

function transcripts() {
  const out = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(path.join(root, dir.name))) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(root, dir.name, f);
      out.push({ id: f.slice(0, -6), file, mtime: statSync(file).mtimeMs });
    }
  }
  return out;
}

/** One entry per API call (a reply streamed in parts repeats its usage: counted once). */
function calls(file) {
  const seen = new Set();
  const list = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const m = j.message ?? {};
    const u = m.usage;
    if (j.type !== 'assistant' || !u || seen.has(m.id)) continue;
    seen.add(m.id);
    const write = u.cache_creation_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    const fresh = u.input_tokens ?? 0;
    if (write + read + fresh === 0) continue; // not an API call (a local or synthetic reply)
    list.push({
      at: j.timestamp,
      source: SOURCE[j.entrypoint] ?? j.entrypoint ?? '?',
      write,
      read,
      fresh,
      out: u.output_tokens ?? 0,
    });
  }
  return list;
}

const n = (x) => x.toLocaleString('en-US');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const mins = (a, b) => ((Date.parse(b) - Date.parse(a)) / 60_000).toFixed(1);

function report({ id, file }) {
  const list = calls(file);
  console.log(`\n=== ${id}  (${path.basename(path.dirname(file))})`);
  if (!list.length) return console.log('  no API calls recorded');
  const sum = (k) => list.reduce((s, c) => s + c[k], 0);
  const [w, r, f, o] = [sum('write'), sum('read'), sum('fresh'), sum('out')];
  console.log(
    `  calls ${list.length} | cache read ${n(r)} | cache write ${n(w)} | uncached ${n(f)} | output ${n(o)}`,
  );
  console.log(`  served from cache: ${pct(r, r + w + f)}`);

  const misses = list.filter((c) => c.write > MISS_WRITE && c.read < 0.9 * (c.read + c.write + c.fresh));
  console.log(`  cache misses (wrote > ${n(MISS_WRITE)}): ${misses.length}`);
  for (const c of misses) {
    const i = list.indexOf(c);
    const gap = i ? `${mins(list[i - 1].at, c.at)} min after the previous call` : 'first call';
    console.log(`    ${c.at.slice(0, 19)}  ${c.source}: wrote ${n(c.write)}, read ${n(c.read)} (${gap})`);
  }

  const switches = list
    .slice(1)
    .map((c, i) => [list[i], c])
    .filter(([a, b]) => a.source !== b.source);
  console.log(`  switches between VS Code / terminal and Pocket Agent: ${switches.length}`);
  for (const [a, b] of switches) {
    const ctx = b.read + b.write + b.fresh;
    console.log(
      `    ${b.at.slice(0, 19)}  ${a.source} → ${b.source}  (${mins(a.at, b.at)} min)  read ${n(b.read)}  write ${n(b.write)}  hit ${pct(b.read, ctx)}`,
    );
  }
}

const args = process.argv.slice(2);
const all = transcripts();
let picked;
if (args[0] === '--recent') picked = all.sort((a, b) => b.mtime - a.mtime).slice(0, Number(args[1] ?? 5));
else if (args.length) picked = args.map((id) => all.find((t) => t.id === id) ?? { id, file: null });
else {
  console.log('Usage: cache-report.mjs <session-id> […]   or   cache-report.mjs --recent <count>');
  process.exit(1);
}
for (const t of picked) {
  if (!t.file) console.log(`\n=== ${t.id}: no transcript on this PC (nothing was said in it)`);
  else report(t);
}
