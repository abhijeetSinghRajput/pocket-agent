import { z } from 'zod';
import { ClaudeUsage, ModelOption } from './events.js';
import { DeviceStatus, Platform } from './enums.js';

// ── Errors ───────────────────────────────────────────────────────────────────
export const ApiError = z.object({ error: z.string(), message: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;

// ── Auth ─────────────────────────────────────────────────────────────────────
export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

export const RegisterRequest = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: Email,
  password: z.string().min(10, 'Use at least 10 characters').max(256, 'Use at most 256 characters'),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1, 'Enter your password').max(256),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const GoogleLoginRequest = z.object({
  /** Firebase Auth ID token from "Sign in with Google". */
  idToken: z.string().min(20).max(8192),
});
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequest>;

export const UserDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type UserDto = z.infer<typeof UserDto>;

export const MeResponse = z.object({ user: UserDto });
export type MeResponse = z.infer<typeof MeResponse>;

/**
 * Sign-in / sign-up answer. `token` is only present for the native apps (they send the
 * `x-pocket-agent-client: mobile` header and keep the session themselves); browsers get a cookie.
 */
export const AuthResponse = MeResponse.extend({ token: z.string().optional() });
export type AuthResponse = z.infer<typeof AuthResponse>;

// ── Devices & pairing ────────────────────────────────────────────────────────
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export const PairingCodeResponse = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type PairingCodeResponse = z.infer<typeof PairingCodeResponse>;

export const PairDeviceRequest = z.object({
  code: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(100),
  platform: Platform,
  agentVersion: z.string().min(1).max(50),
});
export type PairDeviceRequest = z.infer<typeof PairDeviceRequest>;

export const PairDeviceResponse = z.object({ deviceId: z.string(), deviceSecret: z.string() });
export type PairDeviceResponse = z.infer<typeof PairDeviceResponse>;

export const RotateSecretResponse = z.object({ deviceSecret: z.string() });
export type RotateSecretResponse = z.infer<typeof RotateSecretResponse>;

export const DeviceDto = z.object({
  id: z.string(),
  name: z.string(),
  platform: Platform,
  agentVersion: z.string(),
  status: DeviceStatus,
  lastHeartbeatAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  revokedAt: z.iso.datetime({ offset: true }).nullable(),
  remoteApprovalEnabled: z.boolean(),
  /** PC-side allow-list for starting managed sessions (empty until the owner adds projects). */
  projects: z.array(z.object({ name: z.string(), path: z.string() })),
  /** PC-side switch: instructions to sessions the user started themselves. */
  observedInstructions: z.boolean(),
  /** Models this PC's Claude Code offers (empty until the PC reports them). */
  models: z.array(ModelOption).default([]),
  /** Claude plan usage of the account on this PC, if it reported one. */
  usage: ClaudeUsage.nullable().default(null),
  /** Away mode (set from the dashboard or the PC). */
  awayMode: z.boolean(),
});
export type DeviceDto = z.infer<typeof DeviceDto>;

export const SetAwayModeRequest = z.object({ awayMode: z.boolean() });
export type SetAwayModeRequest = z.infer<typeof SetAwayModeRequest>;

export const DeviceListResponse = z.object({ devices: z.array(DeviceDto) });
export type DeviceListResponse = z.infer<typeof DeviceListResponse>;

// ── Device authentication (HTTP + WebSocket upgrade) ─────────────────────────
export const DEVICE_AUTH_SCHEME = 'PocketAgent-Device';

export function deviceAuthHeader(deviceId: string, secret: string): string {
  return `${DEVICE_AUTH_SCHEME} ${deviceId}:${secret}`;
}

export function parseDeviceAuthHeader(
  header: string | undefined,
): { deviceId: string; secret: string } | null {
  if (!header) return null;
  const m = /^PocketAgent-Device ([0-9a-f-]{36}):([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
  return m ? { deviceId: m[1]!, secret: m[2]! } : null;
}

// ── Agent link timing & close codes ──────────────────────────────────────────
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** A device with no heartbeat for this long is shown Offline. */
export const OFFLINE_AFTER_MS = 45_000;

export const WS_CLOSE = {
  /** Server shutting down or restarting: reconnect with backoff. */
  GOING_AWAY: 1001,
  /** Too many invalid frames or oversized frame: reconnect with backoff. */
  POLICY_VIOLATION: 1008,
  /** A newer connection for the same device replaced this one: do not reconnect from this process. */
  REPLACED: 4001,
  /** The device was revoked: never reconnect with these credentials. */
  REVOKED: 4003,
} as const;
