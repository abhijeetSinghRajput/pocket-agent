import { ApiError } from '@pocket-agent/protocol';
import type { z } from 'zod';
import { getToken, signedOut } from '@/lib/session';

/** The API this build talks to. Set EXPO_PUBLIC_API_URL to point a build somewhere else. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://pocket-agent-api.onrender.com').replace(
  /\/+$/,
  '',
);
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws/client';

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

const FRIENDLY: Record<string, string> = {
  not_found: 'Not found',
  unreachable: 'Cannot reach Pocket Agent. Check your connection and try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  internal_error: 'Something went wrong on our side. Please try again.',
};

/** Headers every request carries: who we are (a native app, not a browser) and the session. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return {
    'x-pocket-agent-client': 'mobile',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * JSON request to the API with the session token. Responses are validated against `schema`;
 * failures throw ApiClientError with a message that can be shown as is.
 */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S | null,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<S>> {
  let res: Response;
  const hadToken = !!getToken();
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'omit',
      signal: init.signal,
      headers: {
        ...authHeaders(),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiClientError(0, 'unreachable', FRIENDLY['unreachable']!);
  }
  if (res.status === 204) return undefined as z.infer<S>;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // The session ended on the server (signed out elsewhere, expired): back to sign-in.
    if (res.status === 401 && hadToken && path !== '/auth/login') signedOut();
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

/** The server the PC app uses when no `--api` is given (keep in sync with the agent's DEFAULT_API_URL). */
const AGENT_DEFAULT_API_URL = 'https://pocket-agent-api.onrender.com';
export const AGENT_NPM_PACKAGE = '@mrcodium/pocket-agent';
export const installCommand = () => `npm install -g ${AGENT_NPM_PACKAGE}`;
export const connectCommand = (code: string) =>
  `pocket-agent connect ${code}${API_URL === AGENT_DEFAULT_API_URL ? '' : ` --api ${API_URL}`}`;
