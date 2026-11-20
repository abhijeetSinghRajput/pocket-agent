import { ApiError, HealthResponse } from '@pocket-agent/protocol';
import type { z } from 'zod';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const NOT_FOUND_MESSAGE = 'Not found';

const FRIENDLY: Record<string, string> = {
  not_found: NOT_FOUND_MESSAGE,
  unreachable: 'Cannot reach Pocket Agent. Check your connection and try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  internal_error: 'Something went wrong on our side. Please try again.',
};

/**
 * JSON request to the API with the session cookie. Responses are validated against `schema`;
 * failures throw ApiClientError with a user-presentable message.
 */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S | null,
  init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: init.signal,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError(0, 'unreachable', FRIENDLY['unreachable']!);
  }
  if (res.status === 204) return undefined as z.infer<S>;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ApiError.safeParse(body);
    const code = e.success ? e.data.error : `http_${res.status}`;
    throw new ApiClientError(
      res.status,
      code,
      (e.success && e.data.message) || FRIENDLY[code] || 'Request failed',
    );
  }
  if (!schema) return body as z.infer<S>;
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiClientError(res.status, 'bad_response', 'Unexpected response from Pocket Agent');
  return parsed.data;
}

/** Base URL of the Pocket Agent API. Configured per environment (NEXT_PUBLIC_API_URL). */
export function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error('NEXT_PUBLIC_API_URL is not configured');
  return url.replace(/\/+$/, '');
}

/**
 * The API URL a PC should use (`pocket-agent pair --api …`). The Local Agent talks to the API host
 * directly, never through the web app's /api proxy.
 */
export function agentApiUrl(): string {
  const url = process.env.NEXT_PUBLIC_AGENT_API_URL || apiBaseUrl();
  return url.replace(/\/+$/, '');
}

/** npm package of the PC app (`npm install -g …`). Override per deployment if published elsewhere. */
export const AGENT_NPM_PACKAGE = process.env.NEXT_PUBLIC_AGENT_NPM_PACKAGE || 'pocketagent';

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
    return { kind: 'unreachable', error: 'Cannot reach the Pocket Agent API' };
  }
}
