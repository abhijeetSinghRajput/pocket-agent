import { z } from 'zod';

/** Coding-agent providers. Claude Code runs today; Codex (OpenAI's coding agent) is being added. */
export const ProviderId = z.enum(['claude-code', 'codex', 'antigravity', 'opencode', 'copilot', 'cursor']);
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * managed  = started and owned by the Local Agent (Agent SDK); full control.
 * observed = started by the user (VS Code / CLI); monitored through hooks with limited control.
 */
export const SessionMode = z.enum(['managed', 'observed']);
export type SessionMode = z.infer<typeof SessionMode>;

export const AgentStatus = z.enum([
  'Starting',
  'Running',
  'WaitingForInput',
  'WaitingForPermission',
  'Completed',
  'Failed',
  'Stopped',
  'Disconnected',
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const DeviceStatus = z.enum(['Online', 'Offline', 'Revoked']);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const CommandStatus = z.enum([
  'Pending',
  'Delivered',
  'Accepted',
  'Executing',
  'Completed',
  'Failed',
  'Expired',
]);
export type CommandStatus = z.infer<typeof CommandStatus>;

export const ApprovalStatus = z.enum(['Pending', 'Approved', 'Denied', 'Expired', 'Cancelled']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const Platform = z.enum(['windows', 'macos', 'linux']);
export type Platform = z.infer<typeof Platform>;
