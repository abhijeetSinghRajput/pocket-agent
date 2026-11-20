import { CLAUDE_CODE_CAPABILITIES, type SessionCapabilities } from '@agentdock/protocol';
import { createHash } from 'node:crypto';
import { truncate, type SessionRegistry } from '../../sessions/registry.js';
import { summarizeToolInput, summarizeToolOutput, toolKey } from './summarize.js';

/** Observed session whose hooks reach us (between-turn instructions + approvals are possible). */
export const OBSERVED_WITH_HOOKS: SessionCapabilities = CLAUDE_CODE_CAPABILITIES.observed;
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
 * Pure bookkeeping: it never answers a hook. In M3 every hook is observe-only, so Claude Code's
 * own permission prompt keeps working exactly as without AgentDock.
 */
export class ClaudeHookHandler {
  /** Per session: PreToolUse key → tool_use_id, to correlate PermissionRequest. */
  private readonly toolIds = new Map<string, Map<string, string>>();
  /** Per session: permission requests not yet resolved (requestId → toolUseId). */
  private readonly pendingPermissions = new Map<string, Map<string, string>>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly isManaged: (sessionId: string) => boolean = () => false,
  ) {}

  handle(p: Payload): void {
    const sessionId = s(p['session_id']);
    const event = s(p['hook_event_name']);
    const cwd = s(p['cwd']);
    if (!sessionId || !event || !cwd) return;
    // Managed sessions report through the SDK stream; never double count them.
    if (this.isManaged(sessionId)) return;

    if (event === 'SessionEnd') {
      this.forget(sessionId);
      this.registry.end(sessionId, s(p['reason']) ?? 'ended');
      return;
    }
    this.ensureAnnounced(sessionId, cwd, event === 'SessionStart' ? s(p['source']) : undefined);

    const toolName = s(p['tool_name']) ?? 'unknown';
    switch (event) {
      case 'SessionStart':
        this.registry.setStatus(sessionId, 'WaitingForInput');
        break;

      case 'UserPromptSubmit': {
        const prompt = s(p['prompt']) ?? '';
        this.resolvePending(sessionId);
        this.registry.event(sessionId, 'agent.output', { role: 'user', text: truncate(prompt) });
        this.registry.setStatus(sessionId, 'Running', firstLine(prompt));
        break;
      }

      case 'PreToolUse': {
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
        this.registry.event(sessionId, 'agent.permission.requested', {
          toolUseId,
          toolName,
          input: summarizeToolInput(toolName, p['tool_input']),
          requestId: toolUseId,
        });
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
        const last = s(p['last_assistant_message']);
        if (last) this.registry.event(sessionId, 'agent.output', { role: 'assistant', text: truncate(last) });
        this.registry.setStatus(sessionId, 'WaitingForInput');
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
          capabilities: OBSERVED_WITH_HOOKS,
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
    }
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
