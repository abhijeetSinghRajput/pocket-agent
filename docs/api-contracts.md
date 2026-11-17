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
