import os from 'node:os';
import path from 'node:path';

/**
 * Directory for Local Agent state (device credentials, hook token, logs).
 * Windows: %APPDATA%\PocketAgent · macOS: ~/Library/Application Support/PocketAgent · Linux: $XDG_CONFIG_HOME/pocket-agent.
 * POCKET_AGENT_HOME overrides all of these (used by tests and multi-profile setups).
 */
export function agentHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env['POCKET_AGENT_HOME']) return path.resolve(env['POCKET_AGENT_HOME']);
  if (platform === 'win32') {
    return path.win32.join(env['APPDATA'] ?? path.win32.join(home, 'AppData', 'Roaming'), 'PocketAgent');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'PocketAgent');
  return path.posix.join(env['XDG_CONFIG_HOME'] ?? path.posix.join(home, '.config'), 'pocket-agent');
}
