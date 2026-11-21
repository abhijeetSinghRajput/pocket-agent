import { APPROVAL_WAIT_MS, CLAUDE_CODE_CAPABILITIES, type SessionCapabilities } from '@pocket-agent/protocol';
import { createHash } from 'node:crypto';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import type { AttachmentRef } from '@pocket-agent/protocol';
import type { ApprovalBroker } from '../../approvals.js';
import type { PastedFile } from '../../attachments.js';
import type { ObservedInstructions } from './instructions.js';
import type { IdleWake } from './wake.js';
import { summarizeToolInput, summarizeToolOutput, toolKey } from './summarize.js';
import { TranscriptTail } from './transcript.js';

/** JSON a hook may print to answer Claude Code: Stop (deliver an instruction) or PermissionRequest (remote decision). */
export type HookOutput =
  | { decision: 'block'; reason: string }
  /** Stop the turn (an interrupt sent from Pocket Agent). */
  | { continue: false; stopReason: string }
  | {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit' | 'PostToolUse' | 'PostToolUseFailure';
        additionalContext: string;
      };
    }
  | {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest';
        // Exactly what Claude asked for: never updatedInput / updatedPermissions.
        decision: { behavior: 'allow' } | { behavior: 'deny'; message: string };
      };
    };

/** Observed session whose hooks reach us (between-turn instructions + approvals are possible). */
export const OBSERVED_WITH_HOOKS: SessionCapabilities = CLAUDE_CODE_CAPABILITIES.observed;

/** Observed capabilities given the PC owner's policy (instructions and approvals are opt-in on the PC). */
export function observedCapabilities(
  instructionsAllowed: boolean,
  remoteApprovalAllowed = false,
  wakeIdleAllowed = false,
): SessionCapabilities {
  return {
    ...OBSERVED_WITH_HOOKS,
    instructBetweenTurns: instructionsAllowed,
    // Stopping is part of the same opt-in: Claude stops at its next step.
    interrupt: instructionsAllowed,
    // With wake on, an idle session takes an instruction at once (a busy one: after its turn).
    instructAnytime: instructionsAllowed && wakeIdleAllowed,
    remoteApproval: remoteApprovalAllowed,
  };
}
/** Observed via discovery only (no hooks installed): coarse status, nothing else. */
export const MONITOR_ONLY: SessionCapabilities = {
  monitor: true,
  remoteApproval: false,
  instructAnytime: false,
  instructBetweenTurns: false,
  interrupt: false,
};

type Payload = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * Translates Claude Code hook payloads (see test/fixtures) into session events.
 * It answers only two hooks, and only with the PC owner's consent:
 * - Stop, to deliver an instruction (`pocket-agent instructions enable`);
 * - PermissionRequest, with a decision made in Pocket Agent — only when remote approval is enabled on
 *   the PC (`pocket-agent approvals enable`) AND the user is in Away mode. Otherwise Claude Code's
 *   own permission prompt is untouched. If no decision arrives in time, it answers nothing and
 *   Claude Code falls back to asking on the PC.
 */
export class ClaudeHookHandler {
  /** Per session: PreToolUse key → tool_use_id, to correlate PermissionRequest. */
  private readonly toolIds = new Map<string, Map<string, string>>();
  /** Per session: permission requests not yet resolved (requestId → toolUseId). */
  private readonly pendingPermissions = new Map<string, Map<string, string>>();
  /** What Claude says between tool calls, read from the session's transcript. */
  readonly transcripts = new TranscriptTail();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly isManaged: (sessionId: string) => boolean = () => false,
    private readonly opts: {
      instructions?: ObservedInstructions;
      instructionsAllowed?: () => boolean;
      wakeIdleAllowed?: () => boolean;
      /**
       * Uploads files the user attached in the editor (PC opt-in). When absent or off, those files
       * are never read from the transcript.
       */
      shareFiles?: (files: PastedFile[]) => Promise<AttachmentRef[]>;
      shareFilesAllowed?: () => boolean;
      wake?: IdleWake;
      approvals?: ApprovalBroker;
      remoteApprovalAllowed?: () => boolean;
      /** Remote approval allowed AND the user is away: hold permission requests for Pocket Agent. */
      holdForRemote?: () => boolean;
      approvalWaitMs?: number;
      now?: () => number;
    } = {},
  ) {}

  private capabilities(): SessionCapabilities {
    return observedCapabilities(
      this.opts.instructionsAllowed?.() ?? false,
      this.opts.remoteApprovalAllowed?.() ?? false,
      this.opts.wakeIdleAllowed?.() ?? false,
    );
  }

  /** Re-announces hook-connected sessions after the PC's policy changed. */
  refreshCapabilities(): void {
    for (const t of this.registry.live()) {
      if (t.mode === 'observed' && t.sources.has('hooks')) {
        this.registry.announce({ ...t, capabilities: this.capabilities() }, 'hooks');
      }
    }
  }

  handle(p: Payload): HookOutput | Promise<HookOutput | undefined> | undefined {
    const sessionId = s(p['session_id']);
    const event = s(p['hook_event_name']);
    const cwd = s(p['cwd']);
    if (!sessionId || !event || !cwd) return;
    // Managed sessions report through the SDK stream; never double count them.
    if (this.isManaged(sessionId)) return;

    if (event === 'SessionEnd') {
      for (const id of this.pendingPermissions.get(sessionId)?.keys() ?? []) {
        this.registry.event(sessionId, 'agent.permission.resolved', { requestId: id, outcome: 'cancelled' });
        this.opts.approvals?.cancel(id);
      }
      this.flushText(sessionId);
      this.forget(sessionId);
      this.transcripts.forget(sessionId);
      this.opts.instructions?.onSessionEnd(sessionId);
      this.opts.wake?.onSessionEnd(sessionId);
      this.registry.end(sessionId, s(p['reason']) ?? 'ended');
      return;
    }
    this.ensureAnnounced(sessionId, cwd, event === 'SessionStart' ? s(p['source']) : undefined);
    this.transcripts.attach(sessionId, s(p['transcript_path']));
    // Claude's words since the last hook come first, in the order the editor shows them.
    this.flushText(sessionId);

    const toolName = s(p['tool_name']) ?? 'unknown';
    switch (event) {
      case 'SessionStart':
        this.registry.setStatus(sessionId, 'WaitingForInput');
        break;

      case 'UserPromptSubmit': {
        // A turn sent from Pocket Agent is running in this session right now: hold the PC's prompt
        // back rather than let two copies of the conversation diverge.
        const busy = this.opts.wake?.blockPrompt(sessionId);
        if (busy) return { decision: 'block', reason: busy };
        const prompt = s(p['prompt']) ?? '';
        this.resolvePending(sessionId);
        this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(prompt) });
        this.registry.setStatus(sessionId, 'Running', firstLine(prompt));
        // Tell Claude (in the editor) what was done through Pocket Agent while it was idle.
        const catchUp = this.opts.wake?.catchUp(sessionId);
        if (catchUp) {
          return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: catchUp } };
        }
        break;
      }

      case 'PreToolUse': {
        // Asked to stop from Pocket Agent: this tool doesn't run and the turn ends here.
        const stopped = this.stopIfAsked(sessionId);
        if (stopped) return stopped;
        const id = s(p['tool_use_id']);
        if (!id) break;
        this.map(this.toolIds, sessionId).set(toolKey(toolName, p['tool_input']), id);
        this.registry.event(sessionId, 'agent.tool.started', {
          toolUseId: id,
          toolName,
          input: summarizeToolInput(toolName, p['tool_input']),
        });
        break;
      }

      case 'PermissionRequest': {
        // Claude Code doesn't include tool_use_id here: match the PreToolUse with the same input.
        const key = toolKey(toolName, p['tool_input']);
        const toolUseId = this.map(this.toolIds, sessionId).get(key) ?? `perm-${hash(sessionId + key)}`;
        this.map(this.pendingPermissions, sessionId).set(toolUseId, toolUseId);
        // Claude's question to the user can't be answered through a hook (verified): it is never
        // held for Pocket Agent, so the editor shows it at once.
        const hold = !!this.opts.approvals && !!this.opts.holdForRemote?.() && toolName !== 'AskUserQuestion';
        const waitMs = this.opts.approvalWaitMs ?? APPROVAL_WAIT_MS.observed;
        this.registry.event(sessionId, 'agent.permission.requested', {
          toolUseId,
          toolName,
          input: summarizeToolInput(toolName, p['tool_input']),
          requestId: toolUseId,
          ...(hold
            ? {
                awaitingRemote: true,
                expiresAt: new Date((this.opts.now ?? Date.now)() + waitMs).toISOString(),
              }
            : {}),
        });
        if (hold) return this.awaitRemote(sessionId, toolUseId, waitMs);
        break;
      }

      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const id = s(p['tool_use_id']);
        if (!id) break;
        this.resolvePending(sessionId, id);
        this.map(this.toolIds, sessionId).delete(toolKey(toolName, p['tool_input']));
        const input = summarizeToolInput(toolName, p['tool_input']);
        if (event === 'PostToolUse') {
          this.registry.event(sessionId, 'agent.tool.completed', {
            toolUseId: id,
            toolName,
            input,
            output: summarizeToolOutput(toolName, p['tool_response']),
          });
        } else {
          const error = s(p['error']) ?? summarizeToolOutput(toolName, p['tool_response']) ?? '';
          this.registry.event(sessionId, 'agent.tool.failed', {
            toolUseId: id,
            toolName,
            input,
            error: truncate(error || 'Tool failed', 2000),
          });
        }
        const stopped = this.stopIfAsked(sessionId);
        if (stopped) return stopped;
        // A message sent from Pocket Agent while Claude works reaches it here, at its next step
        // (only with the PC owner's consent; never inside a subagent, which isn't the conversation).
        if (this.opts.instructionsAllowed?.() && !s(p['agent_id'])) {
          const context = this.opts.instructions?.onToolDone(sessionId);
          if (context) return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
        }
        break;
      }

      case 'Notification': {
        const type = s(p['notification_type']);
        if (type === 'idle_prompt') this.registry.setStatus(sessionId, 'WaitingForInput');
        if (type === 'permission_prompt') this.registry.setStatus(sessionId, 'WaitingForPermission');
        break;
      }

      case 'Stop': {
        this.resolvePending(sessionId);
        // Usually already read from the transcript; reported here only if it wasn't.
        const last = s(p['last_assistant_message']);
        if (last && this.transcripts.claim(sessionId, last)) {
          this.registry.event(sessionId, 'agent.output', { role: 'assistant', text: truncate(last) });
        }
        this.registry.setStatus(sessionId, 'WaitingForInput');
        // Deliver a queued instruction (only if the PC owner allowed it — checked when queued).
        if (this.opts.instructionsAllowed?.()) return this.opts.instructions?.onStop(sessionId);
        break;
      }

      case 'StopFailure':
        this.resolvePending(sessionId);
        this.registry.event(sessionId, 'agent.error', {
          message: truncate(s(p['error']) ?? s(p['message']) ?? 'The turn ended with an API error'),
        });
        this.registry.setStatus(sessionId, 'Failed');
        break;

      case 'SubagentStart':
      case 'SubagentStop': {
        const type = s(p['agent_type']) ?? 'subagent';
        const verb = event === 'SubagentStart' ? 'started' : 'finished';
        this.registry.event(sessionId, 'agent.output', { role: 'system', text: `Subagent ${type} ${verb}` });
        break;
      }

      default:
      // Other hook events aren't needed for monitoring.
    }
  }

  private stopIfAsked(sessionId: string): HookOutput | undefined {
    if (!this.opts.instructionsAllowed?.() || !this.opts.instructions?.takeStop(sessionId)) return undefined;
    this.resolvePending(sessionId);
    this.registry.event(sessionId, 'agent.output', { role: 'system', text: 'Turn interrupted remotely' });
    this.registry.setStatus(sessionId, 'WaitingForInput');
    return { continue: false, stopReason: 'Stopped from Pocket Agent.' };
  }

  private flushText(sessionId: string): void {
    const share = this.opts.shareFiles && this.opts.shareFilesAllowed?.() ? this.opts.shareFiles : undefined;
    for (const entry of this.transcripts.read(sessionId, !!share)) {
      if (entry.kind === 'files') {
        // Uploaded in the background; the chat attaches them to the message they came with.
        void share!(entry.files)
          .then((attachments) => {
            if (attachments.length)
              this.registry.event(sessionId, 'agent.output', { role: 'user', text: '', attachments });
          })
          .catch(() => undefined);
        continue;
      }
      this.registry.event(sessionId, 'agent.output', {
        // "Thought for 2s" is a note about the turn (the thinking itself never leaves the PC).
        role: entry.kind === 'thought' ? 'system' : 'assistant',
        text: truncate(entry.text),
      });
    }
  }

  private ensureAnnounced(sessionId: string, cwd: string, source?: string): void {
    const existing = this.registry.get(sessionId);
    // First hook for a session (or the first after discovery found it): hooks are connected.
    if (!existing || !existing.sources.has('hooks') || source) {
      this.registry.announce(
        {
          externalSessionId: sessionId,
          provider: 'claude-code',
          mode: 'observed',
          projectPath: cwd,
          status: existing?.status ?? 'Running',
          capabilities: this.capabilities(),
          metadata: { hooks: 'connected', ...(source ? { startSource: source } : {}) },
        },
        'hooks',
      );
    }
  }

  /** Any outstanding permission request was answered on the PC (allowed or denied there). */
  private resolvePending(sessionId: string, toolUseId?: string): void {
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending?.size) return;
    const ids = toolUseId ? (pending.has(toolUseId) ? [toolUseId] : []) : [...pending.keys()];
    for (const id of ids) {
      pending.delete(id);
      this.registry.event(sessionId, 'agent.permission.resolved', { requestId: id, outcome: 'local' });
      this.opts.approvals?.cancel(id); // stop waiting for the phone
    }
  }

  /** Holds a PermissionRequest hook until Pocket Agent decides, it times out, or the PC answers. */
  private async awaitRemote(
    sessionId: string,
    requestId: string,
    waitMs: number,
  ): Promise<HookOutput | undefined> {
    const decision = await this.opts.approvals!.wait(requestId, waitMs);
    const pending = this.pendingPermissions.get(sessionId);
    if (!pending?.has(requestId)) return undefined; // answered on the PC meanwhile
    pending.delete(requestId);
    if (!decision) {
      // No decision in time: answer nothing, so Claude Code asks on the PC (or denies, headless).
      this.registry.event(sessionId, 'agent.permission.resolved', { requestId, outcome: 'timeout' });
      return undefined;
    }
    this.registry.event(sessionId, 'agent.permission.resolved', { requestId, outcome: 'remote' });
    this.registry.setStatus(sessionId, 'Running');
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision:
          decision.behavior === 'allow'
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: decision.message },
      },
    };
  }

  private map<V>(m: Map<string, Map<string, V>>, sessionId: string): Map<string, V> {
    let inner = m.get(sessionId);
    if (!inner) m.set(sessionId, (inner = new Map()));
    return inner;
  }

  private forget(sessionId: string): void {
    this.toolIds.delete(sessionId);
    this.pendingPermissions.delete(sessionId);
  }
}

function firstLine(text: string): string {
  return truncate(text.trim().split(/\r?\n/)[0] ?? '', 200);
}

function hash(v: string): string {
  return createHash('sha256').update(v).digest('hex').slice(0, 16);
}
