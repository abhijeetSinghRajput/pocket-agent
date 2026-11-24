import {
  CONFIGURE_AGENT_VERSION,
  isWithinFolder,
  RESUME_ANY_FOLDER_AGENT_VERSION,
  RESUME_MIN_AGENT_VERSION,
  versionBelow,
  type AgentSessionDto,
  type ApprovalDto,
  type DeviceDto,
  type TurnMode,
} from '@pocket-agent/protocol';
import { parseQuestions } from './chat.js';
import { MODE_NAME } from './commands.js';

/**
 * What a chat may do and how it says so, the same on the web and the phone: who can send
 * messages, when they reach Claude, which settings apply, and the words for each.
 */

export const isBusy = (s: Pick<AgentSessionDto, 'status'>) =>
  s.status === 'Running' || s.status === 'WaitingForPermission';

export function canInstruct(s: AgentSessionDto): boolean {
  return !s.endedAt && (s.capabilities.instructAnytime || s.capabilities.instructBetweenTurns);
}

/** Whether Claude Code's hooks report this session (it started after `pocket-agent hooks install`). */
export function hooksAreConnected(s: Pick<AgentSessionDto, 'metadata' | 'capabilities'>): boolean {
  return (
    s.metadata?.['hooks'] === 'connected' ||
    s.capabilities.remoteApproval ||
    s.capabilities.instructBetweenTurns
  );
}

/** When the instruction will actually reach Claude — stated honestly per session type. */
export function deliveryHint(s: AgentSessionDto): string {
  if (s.capabilities.instructAnytime) {
    // Nothing to say for a chat that takes messages as they come (busy: the header's spinner says so).
    return '';
  }
  return s.status === 'WaitingForInput'
    ? 'Claude is idle, so this waits for the next turn you start on the PC. To run it at once, turn on wake on the PC: pocket-agent instructions wake enable'
    : '';
}

/**
 * An ended Claude Code session can be continued from here: the PC reopens the same conversation.
 * Returns why not when it can't (shown in place of the message box), or null when it can.
 */
export function resumeBlocker(s: AgentSessionDto, device: DeviceDto | undefined): string | null {
  const ended = 'This session has ended.';
  if (s.provider !== 'claude-code' || !device || device.status === 'Revoked') return ended;
  if (versionBelow(device.agentVersion, RESUME_MIN_AGENT_VERSION))
    return `${ended} To continue it from here, update Pocket Agent on the PC: \`pocket-agent update\``;
  // Agents from 0.1.5 continue any session in its own folder; older ones need it on the list.
  if (
    versionBelow(device.agentVersion, RESUME_ANY_FOLDER_AGENT_VERSION) &&
    !device.projects.some((p) => isWithinFolder(s.projectPath, p.path))
  )
    return `${ended} To continue it from here, allow its folder on the PC: \`pocket-agent projects add "${s.projectPath}"\``;
  return null;
}

/** What ending a session does, said before it happens. */
export const END_TEXT = (s: Pick<AgentSessionDto, 'mode'>) =>
  s.mode === 'managed'
    ? 'Claude stops immediately and the session closes. Queued instructions are not run.'
    : 'This closes the session’s Claude Code process on your PC, whatever it is doing. The conversation is kept: you can resume it in your editor.';

/** How Claude Code asks before acting. "Bypass permissions" is never offered here. */
export const MODES: readonly { id: TurnMode; name: string; description: string }[] = [
  { id: 'default', name: MODE_NAME.default, description: 'Asks before each edit' },
  { id: 'acceptEdits', name: MODE_NAME.acceptEdits, description: 'Edits files without asking' },
  { id: 'plan', name: MODE_NAME.plan, description: 'Explores and plans, changes nothing' },
  { id: 'auto', name: MODE_NAME.auto, description: 'Safe actions run, risky ones ask' },
];

/** How much Claude thinks before answering. */
export const EFFORTS = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Extra high' },
  { id: 'max', name: 'Max' },
] as const;

/** Why the model can't be chosen right now, or null if it can. */
export function modelLock(s: AgentSessionDto): string | null {
  if (s.mode === 'managed') return null;
  if (!s.capabilities.instructAnytime)
    return 'This session runs in your editor with its own settings. Turn on wake on the PC to run turns from here with others.';
  if (isBusy(s)) return 'Claude is mid-turn in your editor; that turn keeps the editor’s settings.';
  return null;
}

/** A question from Claude waiting in this chat (the first one, if several). */
export function pendingQuestion(list: readonly ApprovalDto[] | null | undefined, sessionId: string) {
  for (const a of list ?? []) {
    if (a.sessionId !== sessionId || a.toolName !== 'AskUserQuestion') continue;
    const questions = parseQuestions(a.input);
    if (questions.length) return { approval: a, questions };
  }
  return null;
}

/** One line of Session info: what this chat can do from here, and why. */
export type CapabilityRow = { label: string; state: 'yes' | 'soon' | 'no'; detail: string };

/**
 * What this session can and cannot do, stated plainly. Never claims a capability the session
 * doesn't have (capabilities are reported by the PC).
 */
export function capabilityRows(s: AgentSessionDto): CapabilityRow[] {
  const c = s.capabilities;
  const managed = s.mode === 'managed';
  const hooksConnected = !managed && hooksAreConnected(s);
  const hooksWhy =
    s.metadata?.['hooks'] === 'not-connected'
      ? 'This session started before Pocket Agent hooks were installed. Restart it on the PC to connect it.'
      : 'Pocket Agent hooks are not installed on this PC. Run `pocket-agent hooks install`, then restart the session.';

  const instruct: CapabilityRow = managed
    ? {
        label: 'Send instructions',
        state: 'yes',
        detail: 'Any time. Runs right away, or after the current task.',
      }
    : c.instructAnytime
      ? {
          label: 'Send instructions',
          state: 'yes',
          detail:
            'Any time. If Claude is idle, your PC resumes this session and runs it at once; if it is busy, Claude takes it as soon as it can (its next step, or the end of the turn).',
        }
      : c.instructBetweenTurns
        ? {
            label: 'Send instructions',
            state: 'yes',
            detail:
              'While Claude works, it reads your message at its next step (or when the turn ends). To run it at once when Claude is idle, run `pocket-agent instructions wake enable` on the PC.',
          }
        : hooksConnected
          ? {
              label: 'Send instructions',
              state: 'no',
              detail: 'Turned off on this PC. To allow it, run `pocket-agent instructions enable` on the PC.',
            }
          : { label: 'Send instructions', state: 'no', detail: hooksWhy };

  return [
    {
      label: 'Live status',
      state: c.monitor ? 'yes' : 'no',
      detail:
        managed || hooksConnected
          ? 'Status, tool calls and messages stream here.'
          : 'Coarse status only (running / waiting).',
    },
    instruct,
    {
      label: 'Stop / interrupt',
      state: c.interrupt ? 'yes' : 'no',
      detail: c.interrupt
        ? managed
          ? 'Interrupt the current task or end the session.'
          : 'Stop the current turn (Claude stops at its next step), or end the session: that closes its Claude Code process on the PC.'
        : hooksConnected
          ? 'Turned off on this PC. Run `pocket-agent instructions enable` on the PC to allow stopping from here.'
          : 'Not possible until this session reports through hooks.',
    },
    {
      label: 'Approve permissions remotely',
      state: c.remoteApproval ? 'yes' : 'no',
      detail: c.remoteApproval
        ? managed
          ? 'Requests wait for your decision here. Not decided within 10 minutes: denied.'
          : 'Only while Away mode is on for this PC (Devices). Otherwise, or if not decided within 5 minutes, Claude Code asks on the PC.'
        : managed || hooksConnected
          ? 'Turned off on this PC; actions that need approval are answered there (managed: denied). To allow it, run `pocket-agent approvals enable` on the PC.'
          : hooksWhy,
    },
  ];
}

/**
 * Whether a new mode or model applies to this session at once, mid-turn too: a running session
 * Pocket Agent started, on a PC new enough to switch it. Otherwise it applies from the next message.
 */
export function canConfigureLive(s: AgentSessionDto, device: DeviceDto | undefined): boolean {
  return (
    s.mode === 'managed' &&
    !s.endedAt &&
    !!device &&
    !versionBelow(device.agentVersion, CONFIGURE_AGENT_VERSION)
  );
}

/** A folder you chatted in lately, on a PC that can open it now. */
export type RecentWorkspace = { deviceId: string; deviceName: string; name: string; path: string };

/**
 * The folders of your latest chats, newest first, once each: only on PCs online now and inside a
 * folder that PC allows (so one tap can start there).
 */
export function recentWorkspaces(
  sessions: readonly AgentSessionDto[],
  devices: readonly DeviceDto[],
  limit = 4,
): RecentWorkspace[] {
  const out: RecentWorkspace[] = [];
  const seen = new Set<string>();
  const byNewest = [...sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  for (const s of byNewest) {
    if (out.length >= limit) break;
    const d = devices.find((x) => x.id === s.deviceId);
    if (!d || d.status !== 'Online' || !s.projectPath) continue;
    if (!d.projects.some((p) => isWithinFolder(s.projectPath, p.path))) continue;
    const key = `${d.id}|${s.projectPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ deviceId: d.id, deviceName: d.name, name: s.projectName, path: s.projectPath });
  }
  return out;
}

/** Which chats a list shows: active ones, all of them, or the archived ones. */
export type ChatScope = 'active' | 'all' | 'archived';

/**
 * A chat list's rows: archived chats only under Archived (and nowhere else), pinned ones first,
 * then the most recent activity.
 */
export function chatList(sessions: readonly AgentSessionDto[], scope: ChatScope): AgentSessionDto[] {
  return sessions
    .filter((s) =>
      scope === 'archived' ? s.archived : !s.archived && (scope === 'all' || s.endedAt === null),
    )
    .sort(
      (a, b) =>
        Number(b.pinned && scope !== 'archived') - Number(a.pinned && scope !== 'archived') ||
        Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    );
}
