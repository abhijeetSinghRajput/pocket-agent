# API contracts

Source of truth for request and response shapes: the Zod schemas in `packages/protocol`
(`src/api.ts`, `src/health.ts`). This page lists every endpoint that exists today.

## Conventions

- JSON in and out. Errors are `{ "error": "<code>", "message"?: "<human readable>" }`. They never include stack traces or SQL.
- **Browser auth:** an httpOnly `agentdock_session` cookie (`SameSite=Lax`, `Secure` in production).
  CORS allows only the origins in `WEB_ORIGINS`, with credentials.
- **CSRF:** every state-changing browser route also requires an `Origin` header from the `WEB_ORIGINS` allow-list. Otherwise it returns `403 untrusted_origin`.
- **Device auth:** the header `Authorization: AgentDock-Device <deviceId>:<secret>`. It is never accepted from browsers.
- **Rate limits:** per IP, stored in Redis and scaled by `RATE_LIMIT_SCALE`. Over the limit returns `429 rate_limited`.
- Unknown routes, and resources that belong to other users, both return `404 not_found`.

## Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health/live` | none | `200 { status: "ok" }`. Never touches dependencies. |
| GET | `/health` | none | `200` or `503` with a `HealthResponse` covering Postgres and Redis (2 s timeout each) |

## Auth

| Method | Path | Auth | Limit | Body → Response |
|---|---|---|---|---|
| POST | `/auth/register` | Origin | 5/min | `RegisterRequest {name, email, password ≥10}` → `201 {user}` + cookie · `409 email_taken` · `403 registration_disabled` |
| POST | `/auth/login` | Origin | 10/min | `LoginRequest` → `200 {user}` + cookie · `401 invalid_credentials` (same response for an unknown email) · `429 too_many_attempts` after 10 failures in 15 min for that account |
| POST | `/auth/logout` | cookie + Origin | | `204`. The session is revoked server-side. |
| GET | `/auth/me` | cookie | | `200 {user}` · `401 unauthenticated` |

## Devices (browser)

| Method | Path | Auth | Limit | Response |
|---|---|---|---|---|
| POST | `/devices/pairing-codes` | cookie + Origin | 10/min | `201 {code: "7KQ2-M9XD", expiresAt}`. 10 min TTL, single use, at most 5 unused per user (`429 too_many_pairing_codes`). |
| GET | `/devices` | cookie | | `200 {devices: DeviceDto[]}` (own devices only; secrets are never included) |
| POST | `/devices/:id/revoke` | cookie + Origin | | `200 {device}`. Idempotent. Drops the live connection immediately on every API instance. |

## Local Agent

| Method | Path | Auth | Limit | Response |
|---|---|---|---|---|
| POST | `/devices/pair` | pairing code | 10/min | `PairDeviceRequest {code, name, platform, agentVersion}` → `201 {deviceId, deviceSecret}`. The secret is shown once. `400 invalid_or_expired_code` covers unknown, used and expired codes alike. |
| POST | `/agent/credentials/rotate` | device | 5/min | `200 {deviceSecret}` issues a *pending* secret. The old secret keeps working until the new one is used. |
| POST | `/agent/credentials/confirm` | device (new secret) | 10/min | `204`. The pending secret becomes current and the old one stops working. |
| GET | `/ws/agent` | device | | WebSocket upgrade. `401 unauthorized` or `401 device_revoked` before upgrade. See [websocket-events.md](websocket-events.md). |

## Sessions and activity (M3)

All of these require the session cookie and return only the signed-in user's data. Any other user's
session returns `404`.

| Method | Path | Response |
|---|---|---|
| GET | `/sessions?scope=active\|all` | `{sessions: AgentSessionDto[]}`. `active` (the default) lists sessions that haven't ended, most recent activity first, up to 200. |
| GET | `/sessions/:id` | `{session}` with `mode`, `capabilities`, `metadata` (for example `entrypoint: "claude-vscode"`), `status` and `currentTask` |
| GET | `/sessions/:id/events?limit=50&before=<eventId>` | `EventPage {events, nextCursor}`, newest first. Pass `nextCursor` as `before` to page back. |
| GET | `/activity?limit=50&before=<eventId>` | Same as above across all of the user's sessions. Each event also carries `session {id, projectName, deviceName}`. |
| GET | `/overview` | `{devices {online,total}, sessions {active,running,waitingForInput,waitingForPermission,disconnected}, recent: AgentEventDto[8]}` |
| GET | `/ws/client` | WebSocket for live dashboard updates. It needs the session cookie and an allow-listed `Origin` (otherwise `401` / `403`), and only sends server → browser. Close code `4401` means the user signed out. |

## Remote control (M4)

All of these need the session cookie and an allow-listed `Origin`, are limited to 30 per minute, and take a client-generated
`idempotencyKey` (UUID). Retrying with the same key returns the original command (`200`) instead of creating a second one (`201`).
If the PC is offline, the command is recorded as `Failed` with `error: "device_offline"`; it is never queued to run later.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/sessions/:id/instructions` | `{text ≤20 000, idempotencyKey}` | Needs `instructAnytime` (managed) or `instructBetweenTurns` (observed, PC opt-in). Otherwise `409 not_supported`. `409 session_ended` if the session has ended. |
| POST | `/sessions/:id/interrupt` | `{idempotencyKey}` | Managed sessions only (`interrupt` capability). Ends the current turn; the session stays open. |
| POST | `/sessions/:id/stop` | `{idempotencyKey}` | Managed sessions only. Ends the session. |
| POST | `/devices/:id/sessions` | `{projectPath, text, idempotencyKey}` | Starts a managed session. `projectPath` must be on the PC's allow-list (`400 project_not_allowed`), and the PC checks again. |
| GET | `/sessions/:id/commands` | | The last 50 commands for the session, newest first |
| GET | `/commands/:id` | | One command, the caller's own only. `session.start` gains a `sessionId` once the PC reports the new session. |

`CommandDto.status`: `Pending` → `Delivered` → `Accepted` → `Executing` → `Completed` / `Failed`, or `Expired` if it doesn't
start before `expiresAt`. Time limits: an instruction has 15 minutes, a session start 2 minutes, interrupt and stop 1 minute.
`DeviceDto` also gained `projects` and `observedInstructions`. Both are reported by the PC and shown in the dashboard,
but only the PC enforces them.

## Approvals (M5)

| Method | Path | Notes |
|---|---|---|
| GET | `/approvals?status=pending\|all` | `pending` (the default) returns requests still waiting for a decision. `all` returns the last 50 of any status. Each item includes the allow-listed tool input, project, PC, session mode and `expiresAt`. |
| GET | `/approvals/:id` | The caller's own approvals only |
| POST | `/approvals/:id/decision` | `{decision: "allow"\|"deny", message?}`. Needs an allow-listed Origin; limit 60 per minute. Only one decision ever counts (atomic compare-and-set). Errors: `409 already_decided`, `409 expired`, `409 not_pending` (answered on the PC), `409 device_offline` (the decision is **not** consumed, so you can retry). |
| POST | `/devices/:id/away` | `{awayMode}`. Only affects sessions you started yourself, and only if the PC enabled remote approval. Audited. |

Status: an approval stays `Pending` with `decision` set until the PC confirms it applied the decision. It then becomes
`Approved` or `Denied`. If the decision arrived too late (already answered on the PC, timed out, or the session ended), it
becomes `Cancelled` and is never recorded as `Approved`. `Expired` means nobody decided in time. `DeviceDto` gained `awayMode`, and
`remoteApprovalEnabled` is now reported by the PC.
