import type { CommandDto, CommandStatus, TurnMode } from '@pocket-agent/protocol';

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
  configure_failed: 'Your PC could not switch this session. Your choice applies to the next message.',
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

/** Commands shown as a small line in the chat rather than as a message. */
export const isControl = (c: Pick<CommandDto, 'commandType'>) =>
  c.commandType === 'interrupt' || c.commandType === 'session.stop' || c.commandType === 'session.configure';

/** Mode names, as the pickers and the chat show them. */
export const MODE_NAME: Record<TurnMode, string> = {
  default: 'Manual',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
  auto: 'Auto',
};

/** A control sent to a session (interrupt, end, a new mode or model), as the chat shows it. */
export function controlText(c: CommandDto): string {
  let what = 'You ended the session';
  if (c.commandType === 'interrupt') what = 'You interrupted Claude';
  else if (c.commandType === 'session.configure') {
    const mode = c.permissionMode ? `${MODE_NAME[c.permissionMode]} mode` : null;
    what = `You switched to ${[mode, c.model].filter(Boolean).join(' and ')}`;
  }
  return `${what} · ${commandError(c) ?? STATUS_LABEL[c.status]}`;
}

export function commandTitle(c: CommandDto): string {
  switch (c.commandType) {
    case 'interrupt':
      return 'Interrupt';
    case 'session.stop':
      return 'End session';
    case 'session.configure':
      return controlText(c);
    case 'session.start':
      return c.text ?? 'Start session';
    default:
      return c.text ?? 'Instruction';
  }
}

export const isOpen = (s: CommandStatus) => !['Completed', 'Failed', 'Expired'].includes(s);

/**
 * Waits (up to a minute) for the PC to start Claude for a `session.start` command and report the
 * new session, checking every second with `refetch`. Stops early when `keepGoing` says so (the
 * screen was left). Returns the command as last seen: with a `sessionId`, or failed / expired.
 */
export async function waitForSession(
  command: CommandDto,
  refetch: (id: string) => Promise<CommandDto>,
  keepGoing: () => boolean = () => true,
): Promise<CommandDto> {
  const deadline = Date.now() + 60_000;
  while (keepGoing() && !command.sessionId && isOpen(command.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    command = await refetch(command.id);
  }
  return command;
}
