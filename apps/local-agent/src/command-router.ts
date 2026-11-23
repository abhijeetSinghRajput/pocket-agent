import { findConversation } from './providers/claude-code/conversation.js';
import type { BackendToAgent } from '@pocket-agent/protocol';
import { filesNote, type AttachmentClient, type LocalFile } from './attachments.js';
import { isAllowedProject, type Policy } from './policy.js';
import type { CommandAck } from './providers/claude-code/instructions.js';
import type { ObservedInstructions } from './providers/claude-code/instructions.js';
import type { ManagedSessions } from './providers/claude-code/managed.js';
import type { IdleWake } from './providers/claude-code/wake.js';
import type { SessionRegistry } from './sessions/registry.js';

type CommandExecute = Extract<BackendToAgent, { eventType: 'command.execute' }>;

/**
 * An instruction that reached this PC waits in its session's queue until Claude is free, however
 * long the current task takes: the user expects it to run next, not to be dropped after a timeout.
 * (It still never runs if the session ends first; that is reported as failed.)
 */
const QUEUED_UNTIL_RUN = Number.POSITIVE_INFINITY;
export type FullAck = (
  commandId: string,
  status: 'Delivered' | Parameters<CommandAck>[1],
  extra?: Parameters<CommandAck>[2],
) => void;

const MAX_REMEMBERED = 5_000;

/**
 * Executes commands from the backend, after the PC's own checks. The PC is the last line of
 * defence: even a compromised backend can only do what the local policy allows.
 */
export class CommandRouter {
  private readonly seen = new Set<string>();

  constructor(
    private readonly deps: {
      registry: SessionRegistry;
      managed: ManagedSessions;
      /** An ended session's conversation on this PC, with its folder (tests replace it). */
      findConversation?: (sessionId: string) => Promise<{ cwd: string } | null>;
      observed: ObservedInstructions;
      wake?: IdleWake;
      /** Models Claude Code offers on this PC ([] = unknown: any well-formed id is passed on). */
      models?: () => Array<{ id: string }>;
      /** Downloads the files sent with a message. */
      attachments?: Pick<AttachmentClient, 'download'>;
      /** Ends a process (tests inject this). */
      kill?: (pid: number) => void;
      policy: () => Policy;
      ack: FullAck;
      log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
      now?: () => number;
    },
  ) {}

  async handle(msg: CommandExecute): Promise<void> {
    const p = msg.payload;
    const { ack } = this.deps;
    // Re-sent after a reconnect, or duplicated: execute at most once.
    if (this.seen.has(p.commandId)) return;
    this.seen.add(p.commandId);
    if (this.seen.size > MAX_REMEMBERED) this.seen.delete(this.seen.values().next().value!);

    ack(p.commandId, 'Delivered');
    const expiresAt = Date.parse(p.expiresAt);
    if (expiresAt <= (this.deps.now ?? Date.now)()) return ack(p.commandId, 'Expired');

    const fail = (error: string) => ack(p.commandId, 'Failed', { error });
    try {
      // Only models this PC's Claude Code lists itself.
      const model = 'model' in p ? p.model : undefined;
      // Mode and effort for turns Pocket Agent runs (a turn in the editor keeps its own).
      const turn = {
        ...('permissionMode' in p && p.permissionMode ? { permissionMode: p.permissionMode } : {}),
        ...('effort' in p && p.effort ? { effort: p.effort } : {}),
      };
      const known = this.deps.models?.() ?? [];
      if (model && known.length && !known.some((m) => m.id === model)) return fail('model_not_available');
      switch (p.commandType) {
        case 'session.start': {
          // Continue an ended session: any one whose conversation is still on this PC and that isn't
          // running right now. It runs in the folder the conversation recorded (the PC owner already
          // ran it there), so the project list, which is for starting new chats, doesn't apply.
          const resume = p.resume ? msg.sessionId : undefined;
          if (p.resume && !resume) return fail('session_not_found');
          if (resume && this.deps.registry.get(resume)) return fail('session_running');
          let projectPath: string;
          if (resume) {
            const saved = await (this.deps.findConversation ?? findConversation)(resume);
            if (!saved) return fail('conversation_not_found');
            projectPath = saved.cwd;
          } else {
            const allowed = isAllowedProject(this.deps.policy(), p.projectPath);
            if (!allowed) return fail('project_not_allowed');
            projectPath = allowed.path;
          }
          const id = await this.deps.managed.start({
            projectPath,
            prompt: p.text,
            commandId: p.commandId,
            ...(resume ? { resumeSessionId: resume } : {}),
            ...(model ? { model } : {}),
            ...turn,
          });
          return ack(p.commandId, 'Executing', { externalSessionId: id });
        }

        case 'instruction': {
          const sid = msg.sessionId;
          const s = sid ? this.deps.registry.get(sid) : undefined;
          if (!sid || !s) return fail('session_not_found');
          const allowed = s.mode === 'managed' || this.deps.policy().observedInstructions;
          // Files sent with the message are fetched first: Claude gets all of it or nothing.
          let files: LocalFile[] = [];
          if (allowed && p.attachments?.length) {
            if (!this.deps.attachments) return fail('attachments_not_supported');
            try {
              files = await this.deps.attachments.download(p.commandId, p.attachments);
            } catch (err) {
              this.deps.log?.('warn', `attachments of ${p.commandId}: ${(err as Error).message}`);
              return fail('attachment_download_failed');
            }
          }
          const withFiles = files.length ? { files } : {};
          if (s.mode === 'managed') {
            return void (
              this.deps.managed.send(sid, p.text, {
                commandId: p.commandId,
                expiresAt: QUEUED_UNTIL_RUN,
                ...(model ? { model } : {}),
                ...turn,
                ...withFiles,
              }) || fail('session_not_found')
            );
          }
          if (!this.deps.policy().observedInstructions) return fail('instructions_disabled_on_pc');
          if (!s.sources.has('hooks')) return fail('hooks_not_connected');
          const item = { commandId: p.commandId, text: p.text, expiresAt: QUEUED_UNTIL_RUN };
          // Idle (or already woken): run it now instead of waiting for the next turn on the PC.
          const wake = this.deps.wake;
          if (
            wake &&
            this.deps.policy().wakeIdle &&
            (wake.isRunning(sid) || s.status === 'WaitingForInput')
          ) {
            return wake.run(sid, s.projectPath, {
              ...item,
              ...(model ? { model } : {}),
              ...turn,
              ...withFiles,
            });
          }
          // Delivered into the editor's own turn: its model can't be changed from here.
          // A hook can only carry text, so Claude is told where the files were saved.
          this.deps.observed.enqueue(sid, {
            ...item,
            ...(files.length ? { deliver: p.text + filesNote(files) } : {}),
          });
          return;
        }

        case 'interrupt':
        case 'session.stop': {
          const sid = msg.sessionId;
          if (!sid) return fail('session_not_found');
          if (this.deps.managed.isManaged(sid)) {
            const ok =
              p.commandType === 'interrupt'
                ? await this.deps.managed.interrupt(sid)
                : await this.deps.managed.stop(sid);
            return ok ? ack(p.commandId, 'Completed') : fail('session_not_found');
          }
          // A session the user started: only with the PC owner's opt-in.
          const s = this.deps.registry.get(sid);
          if (!s) return fail('session_not_found');
          if (!this.deps.policy().observedInstructions) return fail('instructions_disabled_on_pc');
          const woken = this.deps.wake?.interrupt(sid) ?? false; // a turn we run: stops at once

          if (p.commandType === 'interrupt') {
            if (woken) return ack(p.commandId, 'Completed');
            if (!s.sources.has('hooks')) return fail('hooks_not_connected');
            // Idle: nothing to stop. Working: Claude stops at its next step (the next tool hook).
            if (s.status !== 'Running' && s.status !== 'WaitingForPermission')
              return ack(p.commandId, 'Completed');
            return this.deps.observed.requestStop(sid, p.commandId, expiresAt);
          }

          // End the session: close its Claude Code process on this PC. The conversation stays on
          // disk and can be resumed in the editor.
          if (s.pid === undefined) return fail('process_not_found');
          try {
            (this.deps.kill ?? ((pid) => process.kill(pid)))(s.pid);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err; // already gone is fine
          }
          this.deps.observed.onSessionEnd(sid);
          this.deps.registry.end(sid, 'stopped_remotely');
          return ack(p.commandId, 'Completed');
        }
      }
    } catch (err) {
      this.deps.log?.('error', `command ${p.commandType} failed: ${(err as Error).message}`);
      fail((err as Error).message.slice(0, 300));
    }
  }
}
