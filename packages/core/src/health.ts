import {
  AGENT_RELEASES_URL,
  LATEST_AGENT_VERSION,
  versionBelow,
  type DeviceDto,
} from '@pocket-agent/protocol';
import { timeAgo } from './format.js';
import { agentProduct } from './providers.js';
import { signInCommand } from './session.js';

/** One line of a PC's health check: how it is, and what fixes it when it isn't right. */
export interface HealthCheck {
  key: 'online' | 'version' | 'link' | 'approvals' | `agent-${string}`;
  label: string;
  state: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
  /** Run on the PC to fix it. */
  command?: string;
  /** Opened to fix it (the agent's downloads). */
  link?: string;
}

/**
 * A PC's setup at a glance (the app's health check): online, up to date, Claude Code linked, and
 * phone approvals. Each line that isn't right says how to fix it.
 */
export function pcHealth(d: DeviceDto, now = Date.now()): HealthCheck[] {
  const online = d.status === 'Online';
  const outdated = versionBelow(d.agentVersion, LATEST_AGENT_VERSION);
  return [
    online
      ? { key: 'online', label: 'Online', state: 'ok', detail: 'Connected to Pocket Agent' }
      : {
          key: 'online',
          label: 'Offline',
          state: 'fail',
          detail: d.lastHeartbeatAt
            ? `Last seen ${timeAgo(d.lastHeartbeatAt, now)}. Start Pocket Agent on the PC.`
            : 'Never connected. Start Pocket Agent on the PC.',
          command: 'pocket-agent start --background',
        },
    outdated
      ? {
          key: 'version',
          label: 'Update available',
          state: 'warn',
          detail: `Pocket Agent ${d.agentVersion} on the PC; ${LATEST_AGENT_VERSION} is out. Download it, then install it on the PC.`,
          command: `pocket-agent stop\nnpm install -g ./mrcodium-pocket-agent-${LATEST_AGENT_VERSION}.tgz\npocket-agent start --background`,
          link: AGENT_RELEASES_URL,
        }
      : { key: 'version', label: 'Up to date', state: 'ok', detail: `Pocket Agent ${d.agentVersion}` },
    d.health === null
      ? {
          key: 'link',
          label: 'Claude Code link',
          state: 'info',
          detail: `Not reported by this PC (Pocket Agent ${LATEST_AGENT_VERSION} or newer says).`,
        }
      : d.health.hooks
        ? {
            key: 'link',
            label: 'Claude Code linked',
            state: 'ok',
            detail: 'Sessions you start in VS Code or the terminal show here.',
          }
        : {
            key: 'link',
            label: 'Claude Code not linked',
            state: 'warn',
            detail: 'Sessions you start yourself won’t show here. Connecting again sets it up.',
            command: 'pocket-agent connect',
          },
    // The other coding agents the PC found (Codex, Antigravity): ready, or how to sign in.
    ...d.agents.map((a): HealthCheck => {
      const name = agentProduct(a.provider);
      return a.signedIn
        ? {
            key: `agent-${a.provider}`,
            label: `${name} ready`,
            state: 'ok',
            detail: `Version ${a.version}${a.models.length ? ` · ${a.models.length} models` : ''}`,
          }
        : {
            key: `agent-${a.provider}`,
            label: `${name} signed out`,
            state: 'warn',
            detail: `Sign in to ${name} on the PC to chat with it from here.`,
            // Antigravity signs in when it starts (with your Google account).
            command: signInCommand(a.provider),
          };
    }),
    d.remoteApprovalEnabled
      ? { key: 'approvals', label: 'Phone approvals on', state: 'ok', detail: 'Allow or deny from here.' }
      : {
          key: 'approvals',
          label: 'Phone approvals off',
          state: 'info',
          detail: 'Permission requests are answered on the PC only.',
          command: 'pocket-agent approvals enable',
        },
  ];
}
