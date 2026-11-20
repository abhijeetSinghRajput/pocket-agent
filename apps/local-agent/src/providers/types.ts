import type { AgentStatus, ProviderId, SessionCapabilities, SessionMode } from '@pocket-agent/protocol';

/**
 * Contract every coding-agent provider implements (architecture: Approved constraints #1).
 * Claude Code is the first implementation (M3); Codex/OpenCode can be added later without
 * changes to the API, protocol envelope, or web app. Provider SDKs are imported only inside
 * their own folder under src/providers/<name>/.
 */
export interface ProviderSession {
  provider: ProviderId;
  mode: SessionMode;
  externalSessionId: string;
  projectPath: string;
  status: AgentStatus;
  capabilities: SessionCapabilities;
}

export interface PermissionPrompt {
  requestId: string;
  toolName: string;
  input: unknown;
}

export type PermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

export interface ProviderEvents {
  sessionChanged(session: ProviderSession): void;
  /** Resolve with a decision, or with null to fall back to the provider's local behaviour. */
  permissionRequested(session: ProviderSession, prompt: PermissionPrompt): Promise<PermissionDecision | null>;
}

export interface AgentProvider {
  readonly id: ProviderId;
  /** Capabilities a session of the given mode has with this provider. */
  capabilities(mode: SessionMode): SessionCapabilities;
  start(events: ProviderEvents): Promise<void>;
  stop(): Promise<void>;
  /** Start a managed session. Providers that can't manage sessions throw. */
  startSession(projectPath: string, instruction: string): Promise<ProviderSession>;
  /** Deliver an instruction; how and when depends on the session's capabilities. */
  sendInstruction(externalSessionId: string, text: string): Promise<'delivered' | 'queued'>;
  interrupt(externalSessionId: string): Promise<void>;
}
