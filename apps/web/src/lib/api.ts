import { HealthResponse } from '@agentdock/protocol';

/** Base URL of the AgentDock API. Configured per environment (NEXT_PUBLIC_API_URL). */
export function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error('NEXT_PUBLIC_API_URL is not configured');
  return url.replace(/\/+$/, '');
}

export type HealthResult =
  { kind: 'ok' | 'degraded'; health: HealthResponse } | { kind: 'unreachable'; error: string };

/**
 * Fetches API health. The API returns 503 with a valid body when degraded, so the body is parsed
 * regardless of status. Any network/parse failure is reported as unreachable, never as healthy.
 */
export async function fetchHealth(signal?: AbortSignal, base = apiBaseUrl()): Promise<HealthResult> {
  try {
    const res = await fetch(`${base}/health`, { signal, cache: 'no-store', credentials: 'include' });
    const parsed = HealthResponse.safeParse(await res.json());
    if (!parsed.success) return { kind: 'unreachable', error: 'Unexpected response from API' };
    return { kind: parsed.data.status, health: parsed.data };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { kind: 'unreachable', error: 'Cannot reach the AgentDock API' };
  }
}
