# API contracts

Source of truth for request and response shapes: the Zod schemas in `packages/protocol`. This page lists
the endpoints that exist today, and each milestone adds its own.

## Conventions

- JSON in and out. Errors are `{ "error": "<code>" }` and never include stack traces or SQL.
- Browser auth (M2): httpOnly `Secure` session cookie; CORS allows only the origins listed in `WEB_ORIGINS`.
- Unknown routes return `404 { "error": "not_found" }`.

## Health (M1)

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/health/live` | Liveness: the process is up. Never touches dependencies. | `200 { "status": "ok" }` |
| GET | `/health` | Readiness: checks Postgres and Redis, each with a 2 s timeout. | `200` when all are up, `503` when degraded. Body: `HealthResponse` |

```json
{
  "status": "ok",
  "service": "agentdock-api",
  "version": "0.1.0",
  "uptimeSeconds": 12,
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "redis": { "status": "down", "error": "timeout after 2000ms" }
  }
}
```
