import type { ProviderId, TurnEffort, TurnMode } from '@pocket-agent/protocol';
import type { LocalFile } from '../attachments.js';

/**
 * What every coding agent this PC runs for Pocket Agent (a "managed" session) offers the command
 * router: start a chat, take messages, switch mode or model, stop. Claude Code's
 * `ManagedSessions` is the first; another provider (Codex) adds its own under
 * src/providers/<name>/ and is handed to the router by id. Provider SDKs are imported only inside
 * their own folder.
 */
export interface ManagedRuntime {
  /** Whether this runtime runs the session (its id is the provider's own session id). */
  isManaged(id: string): boolean;
  /** Starts a session (or continues `resumeSessionId`); resolves with its id. */
  start(input: {
    projectPath: string;
    prompt: string;
    model?: string;
    permissionMode?: TurnMode;
    effort?: TurnEffort;
    commandId?: string;
    resumeSessionId?: string;
    files?: LocalFile[];
  }): Promise<string>;
  /** Queues a message; false when the session isn't running here. */
  send(
    id: string,
    text: string,
    command?: {
      commandId: string;
      expiresAt: number;
      model?: string;
      permissionMode?: TurnMode;
      effort?: TurnEffort;
      files?: LocalFile[];
    },
  ): boolean;
  configure(id: string, change: { permissionMode?: TurnMode; model?: string }): Promise<boolean>;
  interrupt(id: string): Promise<boolean>;
  stop(id: string): Promise<boolean>;
  /** Takes back a message still waiting in a queue (to edit it in the app). */
  withdraw(commandId: string): boolean;
}

/** Runtimes of the providers other than Claude Code that this PC has (none yet: Codex is next). */
export type OtherRuntimes = Partial<Record<Exclude<ProviderId, 'claude-code'>, ManagedRuntime>>;
