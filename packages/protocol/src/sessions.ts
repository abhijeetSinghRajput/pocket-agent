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
});
export type AgentSessionDto = z.infer<typeof AgentSessionDto>;

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
