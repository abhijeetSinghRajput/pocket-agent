import type { CommandDto, CommandStatus } from '@pocket-agent/protocol';

export const STATUS_LABEL: Record<CommandStatus, string> = {
  Pending: 'Sending…',
  Delivered: 'Received by your PC',
  Accepted: 'Queued',
  Executing: 'Claude is working on it',
  Completed: 'Done',
  Failed: 'Failed',
  Expired: 'Expired',
};

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export const STATUS_TONE: Record<CommandStatus, Tone> = {
  Pending: 'neutral',
  Delivered: 'neutral',
  Accepted: 'accent',
  Executing: 'accent',
  Completed: 'success',
  Failed: 'danger',
  Expired: 'warning',
};

const ERRORS: Record<string, string> = {
  device_offline: 'Your PC is offline. Nothing was sent.',
  session_not_found: 'The session is no longer running on your PC.',
  instructions_disabled_on_pc: 'Instructions to this session are turned off on your PC.',
  hooks_not_connected:
    'This session started before Pocket Agent hooks were installed; restart it on your PC.',
  project_not_allowed: 'That folder is not on your PC’s project list.',
  not_a_managed_session: 'Only sessions started by Pocket Agent can be controlled this way.',
  interrupted: 'Interrupted before it finished.',
  attachment_download_failed: 'Your PC could not download the attached file, so the message was not run.',
  attachments_not_supported: 'Update Pocket Agent on your PC to send it files.',
  model_not_available: 'That model is not available on your PC.',
  process_not_found:
    'Pocket Agent could not find this session’s process on your PC. Close it in your editor instead.',
  session_ended: 'The session ended before this ran.',
  session_stopped: 'The session was stopped before this ran.',
  session_completed: 'The session ended before this ran.',
  session_error: 'The session failed before this ran.',
  expired: 'Not delivered in time, so it was never run.',
};

export function commandError(c: Pick<CommandDto, 'status' | 'error'>): string | null {
  if (c.status === 'Expired') return ERRORS['expired']!;
  if (c.status !== 'Failed') return null;
  return (c.error && ERRORS[c.error]) || c.error || 'Failed';
}

export function commandTitle(c: CommandDto): string {
  switch (c.commandType) {
    case 'interrupt':
      return 'Interrupt';
    case 'session.stop':
      return 'End session';
    case 'session.start':
      return c.text ?? 'Start session';
    default:
      return c.text ?? 'Instruction';
  }
}

export const isOpen = (s: CommandStatus) => !['Completed', 'Failed', 'Expired'].includes(s);
