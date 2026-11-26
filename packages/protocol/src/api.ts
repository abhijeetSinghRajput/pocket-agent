import { z } from 'zod';
import { ClaudeUsage, DeviceHealth, ModelOption, OtherAgent } from './events.js';
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
  /** The PC's own setup checks (null until a PC from 2.0.0 reports them). */
  health: DeviceHealth.nullable().default(null),
  /** Other coding agents on the PC (Codex), as it reports them (PCs from 2.5.0). */
  agents: z.array(OtherAgent).default([]),
});
export type DeviceDto = z.infer<typeof DeviceDto>;

/**
 * The newest Local Agent released. The app's health check compares each PC with it (bumped with
 * every agent release).
 */
export const LATEST_AGENT_VERSION = '2.13.0';
/** Where the agent's releases are downloaded (the newest is "latest"). */
export const AGENT_RELEASES_URL = 'https://github.com/abhijeetSinghRajput/pocket-agent/releases/latest';

// ── Pairing with a QR code ────────────────────────────────────────────────────
// The PC asks for a pairing request and shows its link as a QR code (and a short check code). The
// phone scans it, shows which PC it is, and you approve; the PC, asking every few seconds, then
// receives its credentials. Nothing is typed.

/** First Local Agent version that pairs with a QR code. */
export const QR_PAIRING_AGENT_VERSION = '2.0.0';
/** How long a pairing request can be approved. */
export const PAIRING_REQUEST_TTL_MS = 10 * 60_000;

/** `POST /devices/pair/requests` (from the PC, no credentials yet). */
export const CreatePairingRequest = z.object({
  name: z.string().trim().min(1).max(100),
  platform: Platform,
  agentVersion: z.string().min(1).max(50),
});
export type CreatePairingRequest = z.infer<typeof CreatePairingRequest>;

export const PairingRequestCreated = z.object({
  requestId: z.string(),
  /** Only the PC has it: it proves the PC asking for credentials is the one that made the request. */
  pollToken: z.string(),
  /** Shown on the PC and on the phone: they must match. */
  check: z.string(),
  /** What the QR code holds: the approve page (the app reads the request id from it). */
  link: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type PairingRequestCreated = z.infer<typeof PairingRequestCreated>;

/** `POST /devices/pair/requests/:id/poll` (from the PC). */
export const PollPairingRequest = z.object({ pollToken: z.string().min(1).max(200) });
export type PollPairingRequest = z.infer<typeof PollPairingRequest>;
/** Still waiting (202); approved answers with `PairDeviceResponse` (201). */
export const PairingPending = z.object({ status: z.literal('pending') });

/** `GET /pairing/requests/:id` (signed in): what you are about to approve. */
export const PairingRequestDto = z.object({
  id: z.string(),
  name: z.string(),
  platform: Platform,
  agentVersion: z.string(),
  check: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.enum(['pending', 'approved', 'declined', 'expired', 'paired']),
});
export type PairingRequestDto = z.infer<typeof PairingRequestDto>;
export const PairingRequestResponse = z.object({ request: PairingRequestDto });
export type PairingRequestResponse = z.infer<typeof PairingRequestResponse>;

/** The request id in a scanned pairing link (`…/pair/<id>`), or null when it isn't one. */
export function pairingRequestId(scanned: string): string | null {
  try {
    const m = /\/pair\/([0-9a-f-]{36})\/?$/i.exec(new URL(scanned.trim()).pathname);
    return m ? m[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** `GET /devices/:id/folders?path=`: the folders directly inside `path` on that PC. */
export const FolderListResponse = z.object({
  path: z.string(),
  folders: z.array(z.object({ name: z.string(), path: z.string() })),
  truncated: z.boolean(),
});
export type FolderListResponse = z.infer<typeof FolderListResponse>;

/** First Local Agent version that can list the folders inside a project (browsing from the app). */
export const FOLDERS_MIN_AGENT_VERSION = '0.1.7';

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
