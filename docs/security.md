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

## Known issues

- `minimatch` (GHSA-g3hv-75wg-m249, moderate, denial of service): reaches us only through ESLint dev tooling and does not ship. Fix by upgrading once ESLint and typescript-eslint publish releases with patched dependencies.
