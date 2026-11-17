# AgentDock — Architecture

Status: **proposed** (pending approval). Grounded in the PoC results in
[`poc/README.md`](../poc/README.md), verified on 2026-11-17 against Claude Code 2.1.325
and `@anthropic-ai/claude-agent-sdk` 0.3.316 on Windows 11.

## 1. System overview

```text
 Phone / desktop browser                 Cloud                              User's Windows PC
┌──────────────────────┐   HTTPS    ┌──────────────────────┐   WSS (outbound   ┌───────────────────────────────┐
│ apps/web (Next.js)   │◄──────────►│ apps/api (Fastify)   │◄──── from PC) ────│ apps/local-agent (Node)       │
│ dashboard, approvals │  REST + WS │ auth, pairing,       │                   │  ├─ backend link (WSS client) │
│ PWA + web push       │            │ routing, approvals,  │                   │  ├─ hook ingest 127.0.0.1     │
└──────────────────────┘            │ notifications        │                   │  ├─ managed sessions (SDK)    │
                                    └───┬─────────┬────────┘                   │  └─ discovery (best-effort)   │
                                        │         │                            └──────┬──────────────┬─────────┘
                                   PostgreSQL   Redis                                  │              │
                                   (durable)   (presence,                     hook relay (stdin)   Agent SDK
                                                pub/sub)                               │              │
                                                                         Claude Code (VS Code/CLI)  Claude Code
                                                                         "observed sessions"        "managed sessions"
```

Rules that hold everywhere:

- The Local Agent only makes **outbound** connections (WSS to the API). Nothing on the PC listens on a
  public interface. Its local hook endpoint binds to `127.0.0.1` and requires a per-install token.
- The browser never talks to the PC and never holds device credentials.
- Every message crossing a process boundary is validated with Zod schemas from `packages/protocol`.
- An approval is valid only for one `(user, device, session, request)` tuple, once, before it expires.
  Push delivery is never treated as authorization.
- **Failure means not approved.** If the channel to the phone is broken, a pending permission falls back
  to Claude Code's own behaviour: the local prompt in interactive sessions, or a deny in headless ones.

## 2. Two session modes (the key design decision)

The PoC showed that Claude Code sessions differ in how much control is available through supported
mechanisms. AgentDock models this explicitly, and the UI shows each session's capabilities.

| Capability | **Managed session** (started by AgentDock) | **Observed session** (user started it in VS Code / CLI) |
|---|---|---|
| Mechanism | Agent SDK `query()` with streaming input, owned by the Local Agent | Command hooks installed in `~/.claude/settings.json`, relayed to the Local Agent |
| Discovery | Known from creation | `SessionStart` hook; best-effort scan of `~/.claude/sessions/*.json` (undocumented) |
| Live status, tool events | Yes (SDK message stream) | Yes (hooks) |
| Remote approve/deny | Yes, via `canUseTool`. No timeout, so the request can wait indefinitely | Yes, via `PermissionRequest` hook (bounded by hook timeout) |
| Send instruction anytime | **Yes**, as an SDK streaming input message | **Only at the end of a turn.** It is queued and delivered through `Stop` → `{"decision":"block","reason":…}`. It cannot wake an already-idle session |
| Interrupt / stop | Yes (`interrupt()`, abort) | No supported mechanism |
| Conversation history | SDK stream | Transcript JSONL (`transcript_path` from hook input) |

**The MVP's "control from phone" path is the managed session.** Observed sessions get monitoring and
approvals, plus best-effort instruction delivery between turns. We never claim to control arbitrary
running VS Code sessions.

Rejected alternative: a **PTY-wrapped interactive CLI** (node-pty). It means scraping a TUI, its
permission prompts are not machine-readable, and it adds a native dependency. The SDK gives structured
messages, structured permissions and interrupts, so node-pty is dropped from the MVP.

Interactive-session caveat (to verify in M3): while a `PermissionRequest` hook is waiting on the
phone, the local permission dialog cannot be answered. Observed sessions therefore route approvals to
the phone only when the device is in **Away mode** (a toggle set in the dashboard or from the Local
Agent tray). Otherwise the hook returns immediately with no decision, and the local dialog behaves normally.

### Approved constraints (owner sign-off, 2026-11-17)

1. **Provider modularity.** The Local Agent talks to coding agents only through an `AgentProvider`
   interface: `discover`, `startSession`, `sendInstruction`, `interrupt`, and a `capabilities` descriptor.
   Claude Code (Agent SDK + hooks) is the first provider. Codex and OpenCode can be added later without
   changing the API, the protocol envelope, or the web app. `AgentSession.provider` records which provider owns a session.
2. **Honest capabilities.** Every session reports `mode` (`managed` | `observed`) and an explicit
   capability set. The UI renders controls only for capabilities the session has, and explains why the
   others are missing. It never implies that observed sessions can be interrupted or prompted on demand.
3. **Remote approval is opt-in and never weakens local settings.**
   - Remote approval is **off by default** for each device. The user turns it on explicitly; for observed
     sessions, Away mode must also be on.
   - AgentDock never changes `permissionMode`, allow/deny rules or any other Claude Code permission
     setting, and never returns `updatedPermissions` or `updatedInput`. The hook installer adds only
     AgentDock hook entries.
   - Claude Code's own deny/ask rules are still evaluated after a hook says allow, so local policy always wins.
   - If anything fails, the request falls back to the local prompt (interactive) or a deny (headless).
   - Every request, decision, expiry, cancellation and setting change is written to an append-only audit log.
4. **Push is a hint, not state.** Approval state lives only in Postgres and is read through the API.
   Notification limitations for each platform are documented in `docs/notifications.md` (M6).
5. **Real integrations, no mock data.** Each page ships together with the backend that feeds it. Pages
   whose backend isn't built yet show an explicit "arrives in Mx" state, never fake data.

## 3. Components

### apps/web — Next.js (App Router) + Tailwind + shadcn/ui
- Pure client of the API. It has no business logic and no database access.
- Calls the API with an httpOnly session cookie. Subscribes to a browser WebSocket channel for live updates.
- PWA: manifest plus a service worker for FCM web push. iOS only delivers web push to *installed* PWAs
  (16.4+), so installability ships with notifications, not after them.

### apps/api — Fastify
Modules:
- `auth`: email + password (argon2id), server-side sessions table, httpOnly `Secure` `SameSite=Lax` cookie.
- `devices`: pairing codes, device credentials, revocation, heartbeat/presence.
- `gateway`: two WebSocket endpoints, `/ws/agent` (devices) and `/ws/client` (browsers).
- `sessions` and `events`: persist session state and an append-only event log.
- `commands`: lifecycle `Pending → Delivered → Accepted → Executing → Completed | Failed | Expired`.
- `approvals`: lifecycle `Pending → Approved | Denied | Expired | Cancelled`.
- `notifications`: preferences, quiet hours, deduplication, FCM delivery, history.

Redis holds device presence (with TTL), pub/sub fan-out between API instances, and rate-limit counters.
Postgres is the source of truth. The MVP runs one API instance, but nothing assumes one.

### apps/local-agent — Node.js service on the PC
- **Backend link**: a WSS client with exponential backoff and jitter, heartbeat every 15 s, and an outbox
  of unacknowledged events that is replayed after reconnect. `eventId` dedupe makes the replay safe.
- **Hook ingest**: an HTTP server on `127.0.0.1:<port>`. The hook relay (a tiny script that Claude Code
  runs) forwards hook stdin with an `X-AgentDock-Token` header read from the agent's state directory.
  The server rejects requests that carry `Origin` headers, which blocks browser CSRF against localhost.
- **Hook installer**: `agentdock hooks install|uninstall` merges AgentDock entries into
  `~/.claude/settings.json`. It makes a backup, leaves other hooks untouched, and is idempotent.
- **Providers** (`src/providers/<name>/`): implementations of `AgentProvider`. `claude-code` covers
  managed sessions (one SDK `query()` per session, an instruction inbox, `canUseTool` → approval) and
  observed sessions (hook ingest). Nothing outside the provider folder imports provider SDKs.
- **Discovery**: reads only `~/.claude/sessions/<pid>.json` (`sessionId`, `cwd`, `status`, `entrypoint`)
  and checks the pid is alive. It **never** reads `*.key` or `~/.claude/ide/*.lock` files, because they
  contain local auth tokens. This format is undocumented, so discovery degrades gracefully when it changes.
- **Credential storage**: the device secret is encrypted with Windows DPAPI (current user) and stored in
  `%APPDATA%\AgentDock`.

## 4. Identity, pairing and trust

1. A logged-in user clicks **Add device**. The API creates a pairing code: 8 characters from the
   Crockford base32 alphabet, valid for 10 minutes, single use, stored as a hash, and rate-limited.
2. The user runs `agentdock pair <code>` on the PC. The agent calls `POST /devices/pair` with the code,
   machine name, platform and version.
3. The API creates the `Device` and returns `deviceId` plus a 256-bit `deviceSecret`, shown only once.
   Only `sha256(deviceSecret)` is stored, because the secret is high-entropy. The code is consumed.
4. On each connection the agent sends `deviceId` + `deviceSecret` in the WS upgrade `Authorization` header.
   The API checks the hash, then checks that the device is not revoked. Revocation closes live sockets
   immediately and refuses all later handshakes.
5. Rotation: `POST /devices/:id/rotate` issues a new secret over the authenticated socket, and the old
   one stops working once the agent acknowledges the new one.

Every API query is scoped by `userId` from the session, and every device message by the
`deviceId` → `userId` binding. Cross-tenant access is a security-test category.

## 5. Permission approval flow (secure path)

```text
Claude Code ──PermissionRequest hook / canUseTool──► Local Agent ──agent.permission.requested──► API
                                                                                                  │ creates Approval(Pending, expiresAt)
                                                                                                  ├─► browser WS approval.created
                                                                                                  └─► FCM push (hint only)
Phone ── POST /approvals/:id/decision {decision, approvalId} (session cookie) ──► API
API: check owner, Pending, not expired, device online → atomic UPDATE … WHERE status='Pending'
API ──approval.decision {approvalId, sessionId, requestId, decision}──► Local Agent
Local Agent: check requestId is still waiting locally → answer the hook / resolve canUseTool → ack
```

- Single-use: the compare-and-set on `status='Pending'` rejects replays and double taps (PoC: second POST → 409).
- Expiry: the API TTL (default 5 min for observed sessions) is shorter than the hook timeout we
  install (360 s; Claude Code's default is 600 s), so the API marks requests `Expired` before Claude Code gives up. Managed sessions can use a longer TTL.
- If the decision reaches the agent after the local request has already resolved (timeout, or answered
  locally), the agent replies `stale`, and the API records `Cancelled`, not `Approved`.
- AgentDock never sends `updatedPermissions` (no "always allow" rules created remotely in the MVP) and
  never sends `updatedInput`. The phone approves exactly what Claude asked for.
- Audit: every state change is an `AgentEvent` row with the actor `userId`, device and timestamps.

## 6. Instruction (command) flow

1. `POST /sessions/:id/commands {type:"instruction", text, idempotencyKey}` creates a `Command(Pending)`.
   A unique `(userId, idempotencyKey)` index makes retries safe.
2. If the device is online, the API sends `command.execute` and marks the command `Delivered` when the
   WS frame is acknowledged. If it's offline, the command fails at once with `device_offline`. Commands
   are never queued for a later reconnect, so they can't run as a surprise.
3. The Local Agent dedupes on `commandId`, then routes the command:
   - managed session → push into the SDK inbox → `Accepted` → `Executing` → `Completed` or `Failed` on the result message
   - observed session → queue for the next `Stop`. The command stays `Accepted` (shown as "will be
     delivered when Claude finishes the current turn") and expires after a TTL if no `Stop` happens.
4. Status updates go to the browser through `command.status.changed`.

## 7. Protocol envelope (`packages/protocol`)

```ts
{ v: 1, eventId: uuid, eventType: string, timestamp: ISO8601,
  deviceId?: string, sessionId?: string, payload: <schema per eventType> }
```

- The schemas form a Zod discriminated union on `eventType`. Unknown or invalid frames are dropped and
  counted, never crashed on.
- Reliability: the agent → API path is at-least-once (outbox + `ack {eventId}`), and the API dedupes on
  `eventId`, giving effectively-once processing. API → agent commands and decisions are acked as well.
- Event types follow the plan (§7). Additions: `agent.permission.resolved`, `command.ack`,
  `approval.decision.ack`, `session.capabilities`.
- Hook payloads are forwarded as normalized events, not raw. Fields are allow-listed, and long tool
  inputs and outputs are truncated (default 8 KB) before they leave the PC.

## 8. Data model (Prisma) — additions to the plan

The plan's entities stay. Additions:
- `AuthSession` (id, userId, tokenHash, expiresAt, userAgent)
- `PairingCode` (codeHash, userId, expiresAt, consumedAt)
- `Device.secretHash`, `Device.revokedAt`
- `AgentSession.mode` (`managed` | `observed`), `capabilities` (JSON), `metadata` (JSON); unique `(deviceId, externalSessionId)` → reconnects don't duplicate sessions
- `AgentEvent.eventId` unique (dedupe), index `(sessionId, createdAt)`
- `Command.idempotencyKey`, `deliveredAt`, `error`
- `Approval.deviceId`, `requestId` (tool_use_id), `decidedBy`, `decision`; partial index on pending approvals
- `NotificationPreference` (userId, category, enabled, quietHours)
- Retention: `AgentEvent` payloads are kept 30 days by default, then deleted by a pruning job. Approvals and commands are kept.

## 9. Deployment

- Web: Vercel (`app.<domain>`).
- API: one container on a host with long-lived WebSocket support (for example Fly.io, Railway or
  Render; to be chosen in M8), at `api.<domain>`, with managed Postgres and Redis. Vercel serverless
  functions are not used for WebSockets.
- Cookies are scoped to the parent domain so the web app and API share an origin family. CORS uses an explicit allow-list.
- Environments: local (Docker Compose for Postgres and Redis), staging, production. Secrets come from env vars, validated at boot with Zod.

## 10. Repository layout

```text
agentdock/
├── apps/
│   ├── web/            Next.js app
│   ├── api/            Fastify API (+ prisma/ schema and migrations)
│   └── local-agent/    PC agent: CLI (pair, start, hooks install), service, hook relay
├── packages/
│   ├── protocol/       Zod schemas + TS types: WS envelope, events, REST DTOs, status machines
│   └── config/         shared tsconfig, eslint, prettier presets
├── infrastructure/docker/   docker-compose.yml (postgres, redis)
├── poc/                Throwaway proofs-of-concept (not part of the product build)
└── docs/
```

Change from the plan: `packages/shared` and `packages/protocol` are merged into one `protocol` package,
because the same Zod schemas serve the REST and WebSocket contracts. Splitting them would create two
overlapping sources of truth.

## 11. Known limitations (stated in the product)

- Observed sessions cannot receive an instruction while idle, and cannot be interrupted remotely.
- Discovery of sessions without AgentDock hooks depends on an undocumented Claude Code file. It is best-effort.
- Approvals for observed sessions are bounded by the hook timeout. Requests that expire fall back to the local prompt.
- Push notifications are best-effort. On iOS they require installing the PWA.
- Remote Control (official, Anthropic-hosted) already exists for some of these needs. AgentDock's
  advantages are approvals, multi-session overview and notifications on the user's own infrastructure.
