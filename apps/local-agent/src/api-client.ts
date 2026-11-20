import {
  ApiError,
  deviceAuthHeader,
  PairDeviceResponse,
  RotateSecretResponse,
  type PairDeviceRequest,
} from '@agentdock/protocol';
import { validateApiUrl } from './config.js';
import { requestJson } from './http.js';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function call(
  apiUrl: string,
  pathname: string,
  init: { method: 'POST'; headers?: Record<string, string>; body?: string },
): Promise<unknown> {
  const url = new URL(pathname, validateApiUrl(apiUrl));
  let res: { status: number; body: unknown };
  try {
    res = await requestJson(url, init);
  } catch {
    throw new ApiRequestError(0, 'unreachable', `Cannot reach AgentDock at ${url.origin}`);
  }
  if (res.status < 200 || res.status >= 300) {
    const err = ApiError.safeParse(res.body);
    const code = err.success ? err.data.error : 'http_error';
    throw new ApiRequestError(
      res.status,
      code,
      err.success ? (err.data.message ?? code) : `HTTP ${res.status}`,
    );
  }
  return res.body;
}

export async function pairDevice(apiUrl: string, req: PairDeviceRequest): Promise<PairDeviceResponse> {
  const body = await call(apiUrl, '/devices/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  return PairDeviceResponse.parse(body);
}

export async function rotateSecret(apiUrl: string, deviceId: string, secret: string): Promise<string> {
  const body = await call(apiUrl, '/agent/credentials/rotate', {
    method: 'POST',
    headers: { authorization: deviceAuthHeader(deviceId, secret) },
  });
  return RotateSecretResponse.parse(body).deviceSecret;
}

/** First use of a rotated secret: makes it current and retires the previous one. */
export async function confirmSecret(apiUrl: string, deviceId: string, secret: string): Promise<void> {
  await call(apiUrl, '/agent/credentials/confirm', {
    method: 'POST',
    headers: { authorization: deviceAuthHeader(deviceId, secret) },
  });
}
