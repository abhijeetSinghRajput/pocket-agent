// Generates hooks.settings.json pointing every hook at relay.mjs (absolute path).
import fs from 'node:fs';
import path from 'node:path';

const relay = `node "${path.join(import.meta.dirname, 'relay.mjs').replaceAll('\\', '/')}"`;
const events = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'PostToolUseFailure', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd',
];
const toolEvents = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const longEvents = new Set(['PermissionRequest', 'Stop']);

const hooks = {};
for (const e of events) {
  hooks[e] = [{
    ...(toolEvents.has(e) ? { matcher: '*' } : {}),
    hooks: [{ type: 'command', command: relay, timeout: longEvents.has(e) ? 120 : 15 }],
  }];
}
fs.writeFileSync(path.join(import.meta.dirname, 'hooks.settings.json'), JSON.stringify({ hooks }, null, 2));
console.log('wrote hooks.settings.json');
