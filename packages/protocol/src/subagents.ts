import { z } from 'zod';
import { AgentEventDto } from './sessions.js';

const iso = z.iso.datetime({ offset: true });

/**
 * Sub-agents of a session as Claude Code records them on the PC (one transcript and one
 * description per sub-agent, next to the session's own transcript). Read live from the PC: the
 * agent map and an agent's prompt, tool calls and transcript, like the editor shows them.
 */

/** First Local Agent version that reads a session's sub-agents for the app. */
export const SUBAGENTS_AGENT_VERSION = '0.1.8';
/** First Local Agent version that says what each running sub-agent is doing now. */
export const SUBAGENT_PROGRESS_AGENT_VERSION = '0.1.10';

/** Most sub-agents listed for one session. */
export const SUBAGENTS_MAX = 100;
/** Most transcript events sent for one sub-agent (the newest are kept, and always the prompt). */
export const SUBAGENT_EVENTS_MAX = 400;

/** One sub-agent: what started it, what it is, and how far it got. */
export const SubagentInfo = z.object({
  /** Claude Code's id for it (its transcript is `agent-<agentId>.jsonl`). */
  agentId: z.string().max(100),
  /** The Agent / Task tool call that started it. */
  toolUseId: z.string().max(200),
  /** The tool call of the sub-agent that started this one; null when the chat itself did. */
  parentToolUseId: z.string().max(200).nullable(),
  /** Its type ("Explore", "general-purpose"…). */
  type: z.string().max(100),
  /** What it was asked to do, in a few words. */
  description: z.string().max(500),
  model: z.string().max(100).nullable(),
  background: z.boolean(),
  finished: z.boolean(),
  /** How deep it was started: 1 by the chat, 2 by a sub-agent of the chat, … */
  depth: z.number().int().min(1).max(20),
  startedAt: iso.nullable(),
  lastActivityAt: iso.nullable(),
  /** Tool calls it made so far. */
  toolCalls: z.number().int().min(0),
  /**
   * What it is doing right now: the tool call it is waiting on (summarised input, as in a chat's
   * tool steps). Null when it is thinking or writing, or has finished. Absent from PCs before
   * 0.1.10 (then nothing is said about it).
   */
  current: z
    .object({ toolName: z.string().max(100), input: z.string().max(2000) })
    .nullable()
    .optional(),
});
export type SubagentInfo = z.infer<typeof SubagentInfo>;

/** A transcript line, in the same form as a session's events (the chat draws both the same way). */
export const SubagentEvent = AgentEventDto.pick({
  id: true,
  eventType: true,
  payload: true,
  createdAt: true,
});
export type SubagentEvent = z.infer<typeof SubagentEvent>;

/** `GET /sessions/:id/agents/:toolUseId`: the session's agent map, and this agent's transcript. */
export const SubagentDetailResponse = z.object({
  agent: SubagentInfo,
  agents: z.array(SubagentInfo),
  events: z.array(AgentEventDto),
  /** Older transcript lines were left out (it was longer than one answer may be). */
  truncated: z.boolean(),
});
export type SubagentDetailResponse = z.infer<typeof SubagentDetailResponse>;
