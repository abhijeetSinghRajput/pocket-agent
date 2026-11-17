#!/usr/bin/env node
// Claude Code hook relay (PoC).
// Claude Code runs this as a "command" hook. It forwards the hook JSON (stdin)
// to the local broker on 127.0.0.1 and prints the broker's response to stdout.
//
// Failure policy (security requirement): if the broker is unreachable or slow,
// print NOTHING and exit 0. Claude Code then falls back to its normal local
// behaviour (the interactive permission prompt). We never fail open to "allow".

const PORT = process.env.AGENTDOCK_BROKER_PORT ?? '47821';
const TIMEOUT_MS = Number(process.env.AGENTDOCK_RELAY_TIMEOUT_MS ?? 110_000);

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const raw = await readStdin();
  const res = await fetch(`http://127.0.0.1:${PORT}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) {
    const text = await res.text();
    if (text.trim()) process.stdout.write(text);
  }
} catch {
  // Broker down / timeout: no output -> Claude Code default behaviour.
}
process.exit(0);
