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

## Controls added in M3 (Claude Code integration and live dashboard)

| Threat | Control | Test |
|---|---|---|
| AgentDock changes how Claude Code behaves | The hook relay **never answers a hook**: it prints nothing and always exits 0, even when the agent is down, so Claude Code's own permission prompt works exactly as before. The installer adds only AgentDock hook entries (tagged `--agentdock-hook`), backs `settings.json` up first, never touches `permissions`, and refuses to edit a file it can't parse. | `ingest-relay`, `install` |
| Managed sessions approving actions on their own | `canUseTool` **denies** every request that needs approval until remote approval ships (M5), and records it as `auto_denied`. Claude Code's user, project and local settings, including deny rules, still apply. | `discovery-managed` |
| Leaking code, file contents or secrets to the cloud | Tool inputs are allow-listed per tool: commands, paths and patterns only. `Write`/`Edit` bodies are reduced to a size, `Read` output is never sent, and MCP and unknown tools send argument *names* only. Only `Bash`/`PowerShell` output is forwarded (truncated), because it's the "terminal output" feature. `transcript_path` and `scratchpad_dir` are never forwarded. | `hooks` (recorded payloads) |
| Reading Claude Code's local auth tokens | Discovery reads only `<config>/sessions/<pid>.json`, never the `*.key` files beside them or `ide/*.lock`. | `discovery-managed` |
| Other local processes or web pages talking to the agent | The ingest endpoint binds 127.0.0.1 on a random port with a per-run 256-bit token (in the user-only state dir). It rejects requests with `Origin`/`Sec-Fetch-Site` (CSRF from a browser) and unexpected `Host` headers (DNS rebinding), and caps bodies at 1 MB. | `ingest-relay` |
| Cross-site WebSocket hijacking of the dashboard feed | `/ws/client` requires an allow-listed `Origin` plus the session cookie. It's server → browser only and closes when the login session signs out. | `client-gateway.int` |
| One user seeing another's sessions or live events | All session, event and activity queries are scoped by the owner's devices. Live events are routed per user. | `sessions.int`, `client-gateway.int` |
| Replayed or forged agent events | `eventId` dedupe, session events must name their session, envelope `deviceId` must match the authenticated device. | `sessions.int`, `gateway.int` |
| Unbounded data retention | Agent events are pruned after `EVENT_RETENTION_DAYS` (30 by default). Audit logs are kept. | `sessions.int` |
| Agent killed by losing its console | stdout/stderr `EPIPE` is ignored, so the agent keeps running when its terminal or parent process goes away. | `console-loss` |

## Controls added in M4 (remote instructions)

| Threat | Control | Test |
|---|---|---|
| Stolen dashboard login used to run Claude anywhere on the PC | Managed sessions start only in folders on the **PC's** allow-list (`agentdock projects add`), matched by exact path, not prefix. The API checks it and the PC checks again. An empty list means no remote starts. | `commands.int`, `commands` |
| Steering sessions the user started themselves | Off by default. The PC owner turns it on with `agentdock instructions enable`, and capabilities reflect the setting. The PC refuses even if the backend sends one anyway. | `commands`, `hooks`, E2E `control` |
| Remote instructions bypassing local permissions | Instructions are just prompts. Claude Code still asks on the PC for every permission, and managed sessions still deny every action that needs approval until M5. The only hook AgentDock answers is **Stop**, never a permission hook. | `hooks`, `ingest-relay` |
| Duplicate execution (retries, reconnects, replays) | Client idempotency key (unique per user), and the PC executes each `commandId` at most once. Reports may only move a command forward. | `commands.int`, `commands` |
| Late execution | Every command has an `expiresAt`. The PC drops expired commands, the API marks them `Expired`, and a late report can't revive them. An offline PC means `Failed (device_offline)` immediately; nothing is queued. | `commands.int`, `hooks` |
| One user or device acting on another's commands | Commands are scoped to the owner's sessions and devices. Reports from any other device are ignored. | `commands.int` |
| Instruction text in the audit trail | The audit log records kind, target, size and outcome, not the instruction text. | `commands.int` |
| CLI crash on error exit (Windows) | The CLI uses `node:http(s)` with no connection pool instead of `fetch`, so it always exits cleanly with code 1. | E2E `pairing` |

## Controls added in M5 (remote approvals)

| Threat | Control | Test |
|---|---|---|
| A stolen dashboard login approving actions on the PC | Remote approval is **off until enabled on the PC** (`agentdock approvals enable`). For sessions the user started, Away mode must also be on. Without both, permission requests never leave the PC. | `approvals`, E2E `approvals` |
| Auto-approval | Nothing is ever approved without a person's decision. No decision means a deny (managed) or Claude Code asking on the PC (sessions the user started). | `approvals` |
| Weakening local permissions | AgentDock never sends `updatedPermissions`, never sends modified input (managed sessions get the original input object back), never changes `permissionMode`, and Claude Code's deny and ask rules still apply. | `approvals`, `install` |
| Replayed or duplicate decisions | Atomic compare-and-set on `Pending` + `decision IS NULL` + not expired. Double taps and replays return `409`. | `approvals.int` |
| Expired requests executed later | The PC stops waiting at `expiresAt`, the API marks it `Expired`, and late decisions are refused. | `approvals.int`, `approvals` |
| A decision recorded as applied when it wasn't | Status becomes Approved or Denied only on the PC's `applied` ack. A late decision becomes `Cancelled`. | `approvals.int` |
| An offline PC consuming the decision | The API refuses with `device_offline` before recording anything. | `approvals.int` |
| Cross-user and cross-device | Approvals are scoped to their owner. Acks are accepted only from the device that owns the approval. | `approvals.int` |
| Push treated as authorization | Approval state lives only in Postgres and the PC, and the dashboard reads it over the API. | design |
| Auditability | `approval.decided` (who, what, when) and `approval.applied` (PC result), plus `device.away_mode` changes. | `approvals.int` |

Note: interactive Claude Code sessions, including VS Code, run hooks only in **trusted** folders. In an untrusted folder,
AgentDock sees nothing from that session, and it falls back safely to plain Claude Code.

## Known issues

- Unacknowledged agent events are held in memory only. If the agent process restarts while offline, those events are lost (the post-connect snapshot still corrects session states).
- `Bash` output is forwarded (truncated to 4 KB). A command that prints a secret will show it in the timeline.
- If Redis is down, rate-limited routes (login, register, pairing) return 500 instead of running unthrottled. This is a deliberate fail-closed choice.
- There is no "sign out other sessions" or session list UI yet.
- On macOS and Linux the device secret is stored in a 0600 file rather than the OS keychain.
- `minimatch` (GHSA-g3hv-75wg-m249, moderate, denial of service): reaches us only through ESLint dev tooling and does not ship. Fix by upgrading once ESLint and typescript-eslint publish releases with patched dependencies.
