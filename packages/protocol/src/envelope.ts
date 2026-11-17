import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

/** Fields shared by every WebSocket message, in any direction. */
export const EnvelopeBase = z.object({
  v: z.literal(PROTOCOL_VERSION),
  eventId: z.uuid(),
  timestamp: z.iso.datetime({ offset: true }),
  deviceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
});
export type EnvelopeBase = z.infer<typeof EnvelopeBase>;

/** Builds a strict envelope schema for one event type and its payload. */
export function defineEvent<const T extends string, P extends z.ZodType>(eventType: T, payload: P) {
  return EnvelopeBase.extend({ eventType: z.literal(eventType), payload }).strict();
}

/** Upper bound for any single frame; larger frames are rejected before parsing. */
export const MAX_FRAME_BYTES = 256 * 1024;
