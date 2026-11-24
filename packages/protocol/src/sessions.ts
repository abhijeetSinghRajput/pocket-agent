import { z } from 'zod';
import { SessionCapabilities } from './capabilities.js';
import { AgentStatus, ProviderId, SessionMode } from './enums.js';

const iso = z.iso.datetime({ offset: true });

/** Statuses of sessions that are still alive (not ended). */
export const ACTIVE_STATUSES: readonly AgentStatus[] = [
  'Starting',
  'Running',
  'WaitingForInput',
  'WaitingForPermission',
  'Disconnected',
];

export const AgentSessionDto = z.object({
  id: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  provider: ProviderId,
  mode: SessionMode,
  externalSessionId: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
  status: AgentStatus,
  capabilities: SessionCapabilities,
  metadata: z.record(z.string(), z.string()).nullable(),
  currentTask: z.string().nullable(),
  startedAt: iso,
  lastActivityAt: iso,
  endedAt: iso.nullable(),
  /** Kept at the top of the chat list. */
  pinned: z.boolean().default(false),
  /** Moved out of the chat list into Archived. */
  archived: z.boolean().default(false),
});
export type AgentSessionDto = z.infer<typeof AgentSessionDto>;

/** `POST /sessions/:id/organize`: pin or archive a chat (archiving also unpins it). */
export const OrganizeSessionRequest = z
  .object({ pinned: z.boolean().optional(), archived: z.boolean().optional() })
  .refine((v) => v.pinned !== undefined || v.archived !== undefined, 'Pin or archive?');
export type OrganizeSessionRequest = z.infer<typeof OrganizeSessionRequest>;

export const SessionListResponse = z.object({ sessions: z.array(AgentSessionDto) });
export type SessionListResponse = z.infer<typeof SessionListResponse>;

export const SessionResponse = z.object({ session: AgentSessionDto });
export type SessionResponse = z.infer<typeof SessionResponse>;

export const AgentEventDto = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: iso,
  /** Present on the cross-session activity feed. */
  session: z.object({ id: z.string(), projectName: z.string(), deviceName: z.string() }).optional(),
});
export type AgentEventDto = z.infer<typeof AgentEventDto>;

export const EventPage = z.object({
  events: z.array(AgentEventDto),
  /** Pass as `before` to fetch older events; null when there are no more. */
  nextCursor: z.string().nullable(),
});
export type EventPage = z.infer<typeof EventPage>;

export const OverviewResponse = z.object({
  devices: z.object({ online: z.number(), total: z.number() }),
  sessions: z.object({
    active: z.number(),
    running: z.number(),
    waitingForInput: z.number(),
    waitingForPermission: z.number(),
    disconnected: z.number(),
  }),
  recent: z.array(AgentEventDto),
});
export type OverviewResponse = z.infer<typeof OverviewResponse>;

/**
 * A worker Claude started inside a session: a sub-agent (the Agent/Task tool) or a workflow. Running
 * until it reports back; background ones report through a task notification.
 */
export const WorkerKind = z.enum(['subagent', 'workflow']);
export type WorkerKind = z.infer<typeof WorkerKind>;
export const WorkerStatus = z.enum(['running', 'done', 'failed', 'stopped']);
export type WorkerStatus = z.infer<typeof WorkerStatus>;

export const WorkerDto = z.object({
  /** The tool call that started it. */
  id: z.string(),
  sessionId: z.string(),
  projectName: z.string(),
  deviceName: z.string(),
  kind: WorkerKind,
  /** What it was asked to do ("Find the upload code"), or the workflow's description. */
  title: z.string(),
  /** The sub-agent's type ("Explore") or the workflow's name. */
  label: z.string().nullable(),
  background: z.boolean(),
  status: WorkerStatus,
  startedAt: iso,
  finishedAt: iso.nullable(),
  /** How it ended, in Claude Code's words ("Agent completed"), when it said. */
  summary: z.string().nullable(),
});
export type WorkerDto = z.infer<typeof WorkerDto>;
export const WorkerListResponse = z.object({ workers: z.array(WorkerDto) });
export type WorkerListResponse = z.infer<typeof WorkerListResponse>;
