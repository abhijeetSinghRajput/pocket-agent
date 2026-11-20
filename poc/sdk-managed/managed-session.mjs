// PoC: a "managed" Claude Code session owned by the Local Agent via the Agent SDK.
// Verifies: (a) several instructions delivered into ONE session over time,
// (b) permission decisions made asynchronously (simulated remote phone),
// (c) a stable session_id across turns.
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-sdk-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Instruction inbox: in the real Local Agent this is fed by backend commands.
const inbox = [];
let wake;
function sendInstruction(text) { inbox.push(text); wake?.(); }

async function* instructions() {
  for (;;) {
    while (!inbox.length) await new Promise((r) => (wake = r));
    const text = inbox.shift();
    if (text === '__close__') return;
    yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
  }
}

// Simulated remote approval: decision arrives 2s later; deny anything touching "forbidden".
async function canUseTool(toolName, input, { toolUseID }) {
  console.log(`[approval.requested] ${toolName} ${JSON.stringify(input.command ?? input)} (${toolUseID})`);
  await sleep(2000);
  const deny = JSON.stringify(input).includes('forbidden');
  console.log(`[approval.decided]  ${deny ? 'deny' : 'allow'}`);
  return deny
    ? { behavior: 'deny', message: 'Denied remotely via Pocket Agent' }
    : { behavior: 'allow', updatedInput: input };
}

const q = query({
  prompt: instructions(),
  options: { cwd, model: 'haiku', canUseTool, settingSources: [], permissionMode: 'default' },
});

const sessionIds = new Set();
let turns = 0;
sendInstruction('Run this bash command: echo one > one.txt');

for await (const m of q) {
  if (m.session_id) sessionIds.add(m.session_id);
  if (m.type === 'system' && m.subtype === 'init') console.log('[init] session', m.session_id);
  if (m.type === 'result') {
    turns++;
    console.log(`[result #${turns}] ${m.subtype}: ${String(m.result ?? '').slice(0, 120).replace(/\n/g, ' ')}`);
    if (turns === 1) sendInstruction('Now run this bash command: echo forbidden > two.txt');
    else if (turns === 2) sendInstruction('Now run: echo three > three.txt');
    else sendInstruction('__close__');
  }
}

console.log('session ids seen:', [...sessionIds]);
console.log('files:', fs.readdirSync(cwd));
