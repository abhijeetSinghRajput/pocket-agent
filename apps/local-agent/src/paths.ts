import os from 'node:os';
import path from 'node:path';

/**
 * Directory for Local Agent state (device credentials, hook token, logs).
 * Windows: %APPDATA%\AgentDock · macOS: ~/Library/Application Support/AgentDock · Linux: $XDG_CONFIG_HOME/agentdock.
 * AGENTDOCK_HOME overrides all of these (used by tests and multi-profile setups).
 */
export function agentHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env['AGENTDOCK_HOME']) return path.resolve(env['AGENTDOCK_HOME']);
  if (platform === 'win32') {
    return path.win32.join(env['APPDATA'] ?? path.win32.join(home, 'AppData', 'Roaming'), 'AgentDock');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'AgentDock');
  return path.posix.join(env['XDG_CONFIG_HOME'] ?? path.posix.join(home, '.config'), 'agentdock');
}
