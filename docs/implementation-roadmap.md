# AgentDock — Implementation Roadmap

Each milestone ends with a working, tested increment. Before closing any milestone, run
`pnpm typecheck && pnpm lint && pnpm test`. Its acceptance criteria must pass before the next milestone starts.

**Sequencing change from the plan:** the plan builds the whole dashboard UI first (Phase 1), then the
integrations. That forces the UI to run on mock data, which the plan also forbids. This roadmap builds
the **app shell and design system** first, then adds each page together with the real backend data that
feeds it. Every page still ships responsive and mobile-first.

## M0 — Risk proof-of-concept ✅ done

Proven on Claude Code 2.1.325 and Windows 11 (details in `poc/README.md`):
- [x] Detect a session (SessionStart hook; `~/.claude/sessions` registry)
- [x] Associate hook events with the correct `session_id`
- [x] Receive a permission request and allow or deny it remotely; a replayed decision is rejected
- [x] Deliver a new instruction to the same session (managed: SDK streaming input; observed: Stop hook between turns)
- [ ] Still to verify in M3: PermissionRequest behaviour inside the **VS Code extension** while the hook is waiting

## M1 — Foundation + app shell ✅ done (2026-11-17)

- pnpm workspace, `packages/config` (tsconfig/eslint/prettier), `packages/protocol` (envelope, enums, status machines)
- `infrastructure/docker/docker-compose.yml`: Postgres 17, Redis 7
- `apps/api`: Fastify, env validation (Zod), Prisma schema + first migration, `/health` (db + redis), structured logging (pino)
- `apps/web`: Next.js, Tailwind, shadcn/ui, light/dark themes, responsive shell (sidebar on desktop, bottom nav on mobile), empty/loading/error primitives, `/health` page showing the API status
- `apps/local-agent`: CLI skeleton (`agentdock --version`, config dir)
- Vitest in every package; Playwright set up with a mobile viewport project
- Docs: README (dev setup), `.env.example` files, `.gitignore` that blocks secrets

**Accept:** all three apps start independently; the migration applies; `/health` is green; CI-style script passes; no secrets in the repo.

## M2 — Authentication + device pairing ✅ done (2026-11-17)

- API: register, login, logout, `me`; argon2id; AuthSession table; rate limits on auth and pairing
- API: pairing codes, `POST /devices/pair`, device list, revoke, rotate
- WS `/ws/agent`: device auth on upgrade, heartbeat, presence in Redis, online/offline transitions persisted
- Local Agent: `agentdock pair <code>`, DPAPI-encrypted credentials, WSS link with backoff and heartbeat
- Web: login/register, Devices page (add device flow with code + instructions, status, last heartbeat, revoke), Settings → account
- Tests: pairing-code expiry/single-use, revoked device rejected, cross-user isolation, invalid WS frames

**Accept:** pair the real Windows PC; it shows Online; stopping the agent → Offline within 45 s; a revoked device cannot reconnect.

## M3 — Local Agent: Claude Code integration + monitoring ✅ done (2026-11-20)

- Hook relay + localhost ingest (token, Origin rejection), `agentdock hooks install|uninstall` (backup, merge, idempotent)
- Event normalization (allow-list + truncation) → outbox → `agent.*` events with ack/dedupe
- Session state machine (Starting/Running/WaitingForInput/WaitingForPermission/Completed/Failed/Stopped/Disconnected)
- Best-effort discovery via `~/.claude/sessions` (never reading `*.key` or IDE lock files)
- Managed sessions: `agentdock` service starts SDK sessions on command (`session.start {cwd, prompt}`)
- API: persist sessions/events; unique `(deviceId, externalSessionId)`; `/ws/client` fan-out
- Web: Overview (real counts), Agents list, Agent details (timeline, current status, capabilities badge), Activity page
- ✅ Verified the VS Code PermissionRequest behaviour live (see architecture: M5 notes). Away-mode gating confirmed as the design.

**Accept:** a real VS Code session and a real managed session both appear with live status; tool events stream into the timeline; an agent reconnect creates no duplicate sessions or events.

## M4 — Remote instructions ✅ done (2026-11-20)

- Command lifecycle + idempotency key; `command.execute` routing; offline → immediate `Failed(device_offline)`
- Managed: inbox delivery, `interrupt`/stop, live assistant output
- Observed: queued Stop-hook delivery with TTL and `stop_hook_active` guard; UI explains "delivered after current turn"
- Web: instruction composer on Agent details (mobile-friendly), command status chips, start a new managed session (pick a project dir from an allow-list configured on the PC)

**Accept:** an instruction sent from the phone runs in the correct managed session; states are visible end to end; a disconnected device shows a clear failure.

## M5 — Remote permission approvals ✅ done (2026-11-20, awaiting owner sign-off; verified live in VS Code)

- Approval lifecycle; atomic decide; TTL < hook timeout; stale-decision handling; audit events
- Managed: `canUseTool` → approval; observed: PermissionRequest hook → approval (Away mode)
- Web: Approvals page + inline approval card on Agent details, showing the full command/tool input, project, device and expiry countdown
- Security tests: replay, expired, cross-user, revoked device, decision for an unknown requestId

**Accept:** a real permission request is approved and another denied from a phone; Claude Code acts on each correctly; duplicate and expired decisions are rejected.

## M6 — Notifications + PWA ✅ built (2026-11-20; real push to a device pending owner keys, see `docs/notifications.md`)

- Manifest, icons, service worker, install prompt
- FCM web push: subscription registration, categories/priority from the plan, quiet hours, deduplication keys, deep links
- Notification history page and unread badge
- Device-disconnected detector (presence TTL expiry → notify)

**Accept:** push arrives on Android Chrome and on an installed iOS PWA; tapping opens the right approval or agent; preferences are respected.

## M7 — Deployment (staging first)

- Choose the API host; Dockerfile; managed Postgres and Redis; secrets; Vercel project; custom domains + TLS
- Staging and production environments; migration-on-deploy; health checks; log retention
- Local Agent pointed at staging; release a packaged Windows build (Node SEA or pkg-style single exe; decided here)

**Accept:** the full mobile checklist (plan §7) passes against staging from a real Android and iOS device.

## M8 — Hardening + MVP sign-off

- Security test pass (plan §8), rate-limit review, dependency audit, threat model in `docs/security.md`
- Playwright E2E of the full MVP scenario (with a real Local Agent against a test Claude session on the dev box)
- Run the 12-step MVP definition manually on production

## Technical risks (ranked)

| # | Risk | Status / mitigation |
|---|---|---|
| 1 | Sending instructions to arbitrary existing VS Code sessions | **Not supported.** Managed sessions (SDK) are the control path; observed sessions get between-turn delivery only. Shown in the UI. |
| 2 | A held PermissionRequest hook blocks the local VS Code dialog | Away-mode gating; verify in M3 |
| 3 | `~/.claude/sessions` format is undocumented and may change | Discovery is best-effort; hooks are the primary signal |
| 4 | Hook timeout vs. phone response time | API TTL < hook timeout; expiry falls back to the local prompt or a deny |
| 5 | Claude Code / SDK version drift | Pin the SDK version; normalize events in one module; contract tests on recorded hook payloads |
| 6 | Localhost ingest abused by a browser page (CSRF) | Token header + reject `Origin` + bind 127.0.0.1 |
| 7 | Mobile web push unreliability (iOS) | PWA install flow; approvals are always visible in the app regardless of push |
| 8 | Long-lived WS hosting | Use a container host, not serverless |
