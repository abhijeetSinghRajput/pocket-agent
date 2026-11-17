# Security

Living document. The full threat model is completed in M8. Architecture-level rules are in
[architecture.md](architecture.md), §1 and the "Approved constraints" section.

## Controls in place (M1)

| Area | Control |
|---|---|
| Secrets | All configuration comes from env vars and is validated at boot. Validation errors name the variable, never its value. `.env*` files are git-ignored, except `.env.example`. |
| Network (dev) | The API binds to `127.0.0.1` by default. Docker Postgres and Redis publish on `127.0.0.1` only. |
| HTTP | Helmet security headers, CORS allow-list with no wildcard, https-only origins enforced in production, 1 MB body limit, generic error bodies, `authorization` and `cookie` headers redacted from logs. |
| Web | `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, no `X-Powered-By`. |
| Data model | Hash-only storage for session tokens, pairing codes and device secrets. Remote approval is off by default (`Device.remoteApprovalEnabled = false`). The `AuditLog` table is append-only. Unique constraints stop replayed events (`AgentEvent.eventId`), duplicate commands (`Command(userId, idempotencyKey)`) and duplicate approvals (`Approval(sessionId, requestId)`). |
| Protocol | Strict Zod envelopes. Approval decisions can only be `allow` or `deny`, with no permission-rule updates. Payload size limits. |
| Supply chain | Exact version pins, preferring releases at least 14 days old, except security fixes. `pnpm` blocks dependency build scripts except for an explicit allow-list (`allowBuilds` in `pnpm-workspace.yaml`). |
| Local Agent | Never reads Claude Code's `~/.claude/sessions/*.key` or `~/.claude/ide/*.lock` files, which hold local auth tokens. |

## Controls added in M2 (authentication and devices)

| Threat | Control | Test |
|---|---|---|
| Password theft from the DB | Argon2id (Node built-in, m=19 MiB, t=2, p=1) with a PHC-encoded hash | `auth.int` |
| Account enumeration through login | Identical `401` for an unknown email and a wrong password; Argon2 runs against a dummy hash so timing matches | `auth.int` |
| Credential stuffing / brute force | 10 logins per minute per IP, plus a lock after 10 failures in 15 min per account (independent of IP) | `auth.int` |
| Session theft or replay | 256-bit random token in an httpOnly, SameSite=Lax (Secure in prod) cookie, stored only as SHA-256. Logout revokes server-side, and sessions expire after 30 days. | `auth.int` |
| CSRF | SameSite=Lax, and state-changing browser routes require an allow-listed `Origin`, which also blocks login CSRF | `auth.int`, `devices.int` |
| Open redirect after login | `?next=` must be a same-site relative path | web unit + E2E |
| Guessing pairing codes | 8 characters (32⁸ ≈ 1.1·10¹² combinations), 10 min TTL, single use (atomic compare-and-set), hash-only storage, 10 attempts per minute per IP, at most 5 unused codes per user | `devices.int`, `auth.int` |
| Device credential theft from the DB | 256-bit secret stored only as SHA-256 and compared in constant time | `devices.int` |
| Device credential theft from the PC | Encrypted at rest with Windows DPAPI (CurrentUser) and passed to PowerShell over stdin, never argv. Other OSes use a 0600 file for now. | local-agent unit |
| Lost or compromised device | Revoking immediately drops the live socket on every instance (Redis pub/sub, plus a DB check on each heartbeat). A revoked device can never authenticate, and the agent deletes its stored credentials. | `gateway.int`, E2E |
| Rotation lock-out | Two-phase rotation: the pending secret is promoted on first use, and the old one stays valid until then | `devices.int` |
| Accessing another user's data | Every query is scoped by the session's `userId`; other users' resources return 404 | `devices.int` |
| Malformed or hostile WS frames | Zod validation, 256 KB cap, `deviceId` spoof check, disconnect after more than 10 invalid frames | `gateway.int` |
| Plaintext transport | The agent refuses `http://` except for loopback | local-agent unit |
| Loosening limits in production | `RATE_LIMIT_SCALE > 1`, `COOKIE_SECURE=false` and non-https origins are refused when `NODE_ENV=production`; the `disableRateLimits` test hook is refused outside `NODE_ENV=test` | API unit |

Audit log entries are written for: register, login, failed login, logout, pairing-code creation, pairing, rotation request, rotation completion and revocation.

## Known issues

- If Redis is down, rate-limited routes (login, register, pairing) return 500 instead of running unthrottled. This is a deliberate fail-closed choice.
- There is no "sign out other sessions" or session list UI yet.
- On macOS and Linux the device secret is stored in a 0600 file rather than the OS keychain.
- `minimatch` (GHSA-g3hv-75wg-m249, moderate, denial of service): reaches us only through ESLint dev tooling and does not ship. Fix by upgrading once ESLint and typescript-eslint publish releases with patched dependencies.
