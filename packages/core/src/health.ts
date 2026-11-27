import {
  AGENT_RELEASES_URL,
  LATEST_AGENT_VERSION,
  ProviderId,
  providerAgentVersion,
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

const models = (n: number) => `${n} model${n === 1 ? '' : 's'}`;

/** Where one coding agent stands on a PC: ready to chat, or what is in the way. */
export interface PcAgent {
  provider: ProviderId;
  state: 'ready' | 'signed-out' | 'update' | 'missing';
  /** The state in a word or two, as the list shows it. */
  label: string;
  /**
   * The account it is signed in with, as the agent itself names it (an email, or "API key"); absent
   * when the PC doesn't know (older PC agents, or an agent that doesn't say).
   */
  account?: string;
  /** One line under the name: the plan or version when ready, otherwise what to do. */
  detail: string;
  /** Run on the PC to fix it. */
  command?: string;
}

/**
 * Every coding agent Pocket Agent works with, as one PC has it: Claude Code first, then the
 * others in the order the app lists them. Only what the PC reports: whether each is installed and
 * signed in, the account where the agent names it, its version and models, and Claude's plan.
 */
export function pcAgents(d: DeviceDto): PcAgent[] {
  const plan = d.usage?.plan;
  const claude: PcAgent = {
    provider: 'claude-code',
    state: 'ready',
    label: 'Ready',
    ...(d.claudeAccount?.email ? { account: d.claudeAccount.email } : {}),
    detail: [
      plan ? `Claude ${plan}` : 'Your Claude Code sign-in',
      d.models.length ? models(d.models.length) : null,
    ]
      .filter(Boolean)
      .join(' · '),
  };
  const others = ProviderId.options
    .filter((p) => p !== 'claude-code')
    .map((provider): PcAgent => {
      const name = agentProduct(provider);
      const found = d.agents.find((a) => a.provider === provider);
      if (versionBelow(d.agentVersion, providerAgentVersion(provider)))
        return {
          provider,
          state: 'update',
          label: 'Update needed',
          detail: `Pocket Agent on the PC is too old for ${name}. Update it there.`,
          command: 'pocket-agent update',
        };
      if (!found)
        return {
          provider,
          state: 'missing',
          label: 'Not installed',
          detail: `${name} isn’t found on this PC. Installed it already? This shows why, on the PC:`,
          command: 'pocket-agent doctor',
        };
      if (!found.signedIn)
        return {
          provider,
          state: 'signed-out',
          label: 'Signed out',
          detail: `Sign in to ${name} on the PC to chat with it from here.`,
          command: signInCommand(provider),
        };
      // "me@example.com" with "ChatGPT Plus" in the detail; or just "API key" when there's no email.
      const acc = found.account;
      const account = acc?.email ?? acc?.plan ?? undefined;
      return {
        provider,
        state: 'ready',
        label: 'Ready',
        ...(account ? { account } : {}),
        detail: [
          acc?.email && acc.plan ? acc.plan : null,
          `Version ${found.version}`,
          found.models.length ? models(found.models.length) : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    });
  return [claude, ...others];
}
