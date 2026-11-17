import { z } from 'zod';
import type { SessionMode } from './enums.js';

/**
 * What a session can actually do. The UI renders controls only for capabilities that are true,
 * and must never imply that a session supports something it doesn't.
 */
export const SessionCapabilities = z.object({
  /** Live status and tool events are reported. */
  monitor: z.boolean(),
  /** Permission requests can be decided remotely (still subject to the user's opt-in). */
  remoteApproval: z.boolean(),
  /** An instruction can be delivered at any time. */
  instructAnytime: z.boolean(),
  /** An instruction can be delivered only after the current turn ends. */
  instructBetweenTurns: z.boolean(),
  /** The running turn can be interrupted. */
  interrupt: z.boolean(),
});
export type SessionCapabilities = z.infer<typeof SessionCapabilities>;

/** Capabilities of Claude Code sessions per mode, as verified in the PoC (poc/README.md). */
export const CLAUDE_CODE_CAPABILITIES: Readonly<Record<SessionMode, SessionCapabilities>> = {
  managed: {
    monitor: true,
    remoteApproval: true,
    instructAnytime: true,
    instructBetweenTurns: true,
    interrupt: true,
  },
  observed: {
    monitor: true,
    remoteApproval: true,
    instructAnytime: false,
    instructBetweenTurns: true,
    interrupt: false,
  },
};
