import { randomUUID } from 'node:crypto';

/**
 * Short-lived SDK sessions the agent starts for itself (reading the model list and plan usage).
 * They are never prompted, but while they run Claude Code lists them like any session, so
 * discovery must skip them; otherwise each one showed up in the app as an empty chat
 * ("Session started", "Session ended").
 */
const ids = new Set<string>();

/** A session id for a helper session; it stays known for a while after the helper ends. */
export function helperSessionId(): { id: string; release: () => void } {
  const id = randomUUID();
  ids.add(id);
  return {
    id,
    // Claude Code may take a moment to exit and remove its session file.
    release: () => void setTimeout(() => ids.delete(id), 2 * 60_000).unref(),
  };
}

export const isHelperSession = (sessionId: string) => ids.has(sessionId);
