import type { BackendToAgent } from '@pocket-agent/protocol';
import { isAllowedProject, type Policy } from './policy.js';
import type { CommandAck } from './providers/claude-code/instructions.js';
import type { ObservedInstructions } from './providers/claude-code/instructions.js';
import type { ManagedSessions } from './providers/claude-code/managed.js';
import type { IdleWake } from './providers/claude-code/wake.js';
import type { SessionRegistry } from './sessions/registry.js';

type CommandExecute = Extract<BackendToAgent, { eventType: 'command.execute' }>;

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
      observed: ObservedInstructions;
      wake?: IdleWake;
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
      switch (p.commandType) {
        case 'session.start': {
          const allowed = isAllowedProject(this.deps.policy(), p.projectPath);
          if (!allowed) return fail('project_not_allowed');
          const id = await this.deps.managed.start({
            projectPath: allowed.path,
            prompt: p.text,
            commandId: p.commandId,
          });
          return ack(p.commandId, 'Executing', { externalSessionId: id });
        }

        case 'instruction': {
          const sid = msg.sessionId;
          const s = sid ? this.deps.registry.get(sid) : undefined;
          if (!sid || !s) return fail('session_not_found');
          if (s.mode === 'managed') {
            return void (
              this.deps.managed.send(sid, p.text, { commandId: p.commandId, expiresAt }) ||
              fail('session_not_found')
            );
          }
          if (!this.deps.policy().observedInstructions) return fail('instructions_disabled_on_pc');
          if (!s.sources.has('hooks')) return fail('hooks_not_connected');
          const item = { commandId: p.commandId, text: p.text, expiresAt };
          // Idle (or already woken): run it now instead of waiting for the next turn on the PC.
          const wake = this.deps.wake;
          if (
            wake &&
            this.deps.policy().wakeIdle &&
            (wake.isRunning(sid) || s.status === 'WaitingForInput')
          ) {
            return wake.run(sid, s.projectPath, item);
          }
          this.deps.observed.enqueue(sid, item);
          return;
        }

        case 'interrupt':
        case 'session.stop': {
          const sid = msg.sessionId;
          if (!sid || !this.deps.managed.isManaged(sid)) return fail('not_a_managed_session');
          const ok =
            p.commandType === 'interrupt'
              ? await this.deps.managed.interrupt(sid)
              : await this.deps.managed.stop(sid);
          return ok ? ack(p.commandId, 'Completed') : fail('session_not_found');
        }
      }
    } catch (err) {
      this.deps.log?.('error', `command ${p.commandType} failed: ${(err as Error).message}`);
      fail((err as Error).message.slice(0, 300));
    }
  }
}
