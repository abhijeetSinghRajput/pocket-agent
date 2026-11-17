import type { AgentStatus, ApprovalStatus, CommandStatus } from './enums.js';

type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Allowed agent status transitions. `Disconnected` is reachable from any live state
 * (device link lost) and can recover to any live state when the device reconnects.
 */
export const AGENT_TRANSITIONS: Transitions<AgentStatus> = {
  Starting: ['Running', 'WaitingForInput', 'Failed', 'Stopped', 'Disconnected'],
  Running: ['WaitingForInput', 'WaitingForPermission', 'Completed', 'Failed', 'Stopped', 'Disconnected'],
  WaitingForInput: ['Running', 'Completed', 'Stopped', 'Failed', 'Disconnected'],
  WaitingForPermission: ['Running', 'WaitingForInput', 'Failed', 'Stopped', 'Disconnected'],
  Completed: ['Running', 'Stopped'],
  Failed: ['Running', 'Stopped'],
  Stopped: [],
  Disconnected: ['Running', 'WaitingForInput', 'WaitingForPermission', 'Completed', 'Failed', 'Stopped'],
};

/** Commands move forward only; terminal states are final. */
export const COMMAND_TRANSITIONS: Transitions<CommandStatus> = {
  Pending: ['Delivered', 'Failed', 'Expired'],
  Delivered: ['Accepted', 'Failed', 'Expired'],
  Accepted: ['Executing', 'Failed', 'Expired'],
  Executing: ['Completed', 'Failed'],
  Completed: [],
  Failed: [],
  Expired: [],
};

/** An approval is decided exactly once. */
export const APPROVAL_TRANSITIONS: Transitions<ApprovalStatus> = {
  Pending: ['Approved', 'Denied', 'Expired', 'Cancelled'],
  Approved: [],
  Denied: [],
  Expired: [],
  Cancelled: [],
};

export function canTransition<S extends string>(table: Transitions<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid status transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition<S extends string>(table: Transitions<S>, from: S, to: S): void {
  if (!canTransition(table, from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal<S extends string>(table: Transitions<S>, status: S): boolean {
  return table[status].length === 0;
}
