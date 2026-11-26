import { spawnLines, type Transport } from '../codex/rpc.js';
import { AcpSessions, type AcpProfile } from '../antigravity/sessions.js';
import { opencodeCommand, toAppModel, toOpencodeModel } from './detect.js';

/**
 * OpenCode's chats run over ACP (`opencode acp`), like Antigravity's. Its modes are its two agents,
 * Build (its default) and Plan, set as the session's "mode" option; its model ids are carried in
 * the app with "::" for "/".
 */
export const OPENCODE_PROFILE: AcpProfile = {
  provider: 'opencode',
  name: 'OpenCode',
  mode: (sessionId, mode) => ({
    method: 'session/set_config_option',
    params: { sessionId, configId: 'mode', value: mode === 'plan' ? 'plan' : 'build' },
  }),
  toAgentModel: toOpencodeModel,
  toAppModel,
};

/** Starts `opencode acp` (the real program, not npm's shim: no shell). */
export function spawnOpencodeAcp(): Transport {
  return spawnLines(opencodeCommand(), ['acp'], false);
}

export class OpencodeSessions extends AcpSessions {}
