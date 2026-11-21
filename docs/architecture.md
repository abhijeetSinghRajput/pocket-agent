# Pocket Agent — Architecture

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
mechanisms. Pocket Agent models this explicitly, and the UI shows each session's capabilities.

| Capability | **Managed session** (started by Pocket Agent) | **Observed session** (user started it in VS Code / CLI) |
|---|---|---|
| Mechanism | Agent SDK `query()` with streaming input, owned by the Local Agent | Command hooks installed in `~/.claude/settings.json`, relayed to the Local Agent |
| Discovery | Known from creation | `SessionStart` hook; best-effort scan of `~/.claude/sessions/*.json` (undocumented) |
| Live status, tool events | Yes (SDK message stream) | Yes (hooks) |
| Remote approve/deny | Yes, via `canUseTool`. No timeout, so the request can wait indefinitely | Yes, via `PermissionRequest` hook (bounded by hook timeout) |
| Send instruction anytime | **Yes**, as an SDK streaming input message | **At the end of a turn**, through `Stop` → `{"decision":"block","reason":…}`. **While idle**, only with the PC opt-in `instructions wake enable`: the Local Agent resumes the same session through the SDK (`resume: <session id>`) for one turn (see "Waking idle observed sessions") |
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
   - Pocket Agent never changes `permissionMode`, allow/deny rules or any other Claude Code permission
     setting, and never returns `updatedPermissions` or `updatedInput`. The hook installer adds only
     Pocket Agent hook entries.
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
  runs) forwards hook stdin with an `X-Pocket Agent-Token` header read from the agent's state directory.
  The server rejects requests that carry `Origin` headers, which blocks browser CSRF against localhost.
- **Hook installer**: `pocket-agent hooks install|uninstall` merges Pocket Agent entries into
  `~/.claude/settings.json`. It makes a backup, leaves other hooks untouched, and is idempotent.
- **Providers** (`src/providers/<name>/`): implementations of `AgentProvider`. `claude-code` covers
  managed sessions (one SDK `query()` per session, an instruction inbox, `canUseTool` → approval) and
  observed sessions (hook ingest). Nothing outside the provider folder imports provider SDKs.
- **Discovery**: reads only `~/.claude/sessions/<pid>.json` (`sessionId`, `cwd`, `status`, `entrypoint`)
  and checks the pid is alive. It **never** reads `*.key` or `~/.claude/ide/*.lock` files, because they
  contain local auth tokens. This format is undocumented, so discovery degrades gracefully when it changes.
- **Credential storage**: the device secret is encrypted with Windows DPAPI (current user), through PowerShell with the secret passed on stdin (no native module), and stored in
  `%APPDATA%\PocketAgent`.

### M3 implementation notes (as built)

```text
Claude Code ──hook──► hook-relay.js ──HTTP 127.0.0.1 + token──► IngestServer ─┐
 (VS Code / CLI)       (Node built-ins only, ~60 ms,                          │
                        prints nothing, exit 0)                               ▼
<config>/sessions/<pid>.json ──scan every 10 s──► ClaudeDiscovery ──► SessionRegistry ──► Outbox ──► AgentLink ──► API
Agent SDK query() ◄── `pocket-agent run` ──► ManagedSessions ──────────────────────┘      (replayed      (WSS)
                                                                                       until acked)
```

- **One registry, three sources.** Hooks are authoritative. Discovery adds sessions without hooks (status only)
  and enriches hook sessions with the `entrypoint` (for example `claude-vscode`). Managed sessions report from the SDK
  stream, and the relay skips them via `POCKET_AGENT_MANAGED_SESSION=1`, so nothing is counted twice. Managed session
  IDs are chosen by the agent (`sessionId` option), so they're recognised before Claude Code starts.
- **Capabilities are recorded per session** and never inferred in the UI. A session seen only through discovery gets
  `MONITOR_ONLY`. It's upgraded to the observed capabilities once its hooks arrive.
- **`PermissionRequest` has no `tool_use_id`** (verified against Claude Code 2.1.325 payloads, which are the test fixtures).
  The handler matches it to the preceding `PreToolUse` with the same tool and input.
- **The relay never answers a hook in M3.** Claude Code's own prompt stays in charge. M5 will add an opt-in
  decision path for Away mode only.
- **Delivery.** Session events go through an in-memory outbox (10 000 maximum) and are removed when acknowledged.
  After each connect the agent replays unacknowledged events, then sends `agent.sessions.snapshot`.
- **Browser updates.** `/ws/client` pushes "what changed" events, the dashboard re-fetches over REST, and pages poll
  every 30 s as a fallback.

### M4 implementation notes (as built)

- **The PC decides.** `policy.json` in the agent state dir holds `projects` (the allow-list for remote session starts) and
  `observedInstructions` (off by default). The CLI edits it and tells the running agent to reload, and the agent reports it to
  the backend as `device.settings`, for display only. Every command is checked against it on the PC.
- **Commands** (`instruction`, `session.start`, `interrupt`, `session.stop`) are recorded in Postgres first, then
  delivered through Redis pub/sub to the instance holding the device's socket. Status comes back as `command.ack` through the agent's
  outbox and only moves forward. Commands expire, and an offline PC means immediate failure.
- **Managed sessions** run one instruction per turn, so "completed" refers to a real turn. `interrupt` uses the SDK's
  `query.interrupt()`, and stop aborts the session.
- **Observed sessions** get an instruction when Claude's turn ends. The Stop hook answers `decision: "block"` with the
  instruction as the reason, verified with real Claude Code to continue in the same session. An idle session can be woken
  only with the PC opt-in below; otherwise the instruction waits (and may expire), and the UI says so.

### Waking idle observed sessions (as built)

Claude Code has no supported way to push a prompt into an idle interactive session. With the PC opt-in
`pocket-agent instructions wake enable` (off by default; it also enables `instructions`), an instruction to an observed
session that is `WaitingForInput` runs at once: the Local Agent calls the Agent SDK with `resume: <session id>`, one turn
per instruction, queued while one runs. Verified with real Claude Code: the same session id continues with its full
history, and a message sent in the browser gets Claude's answer in the chat.

- Permissions are never widened. The user's Claude Code settings (all sources) apply first; anything that would ask goes to
  Pocket Agent only if remote approval is enabled on the PC, otherwise it is denied (the managed-session gate).
- The turn reports through the SDK stream; its own hooks are skipped (`POCKET_AGENT_MANAGED_SESSION`), so nothing is
  counted twice. A busy session is never woken: its instruction still waits for the `Stop` hook.
- The editor keeps its own in-memory copy of the conversation and doesn't see these turns (verified). So while a woken turn
  runs, a prompt typed on the PC is held back (`UserPromptSubmit` → `decision: "block"` with the reason), and the next
  prompt typed on the PC receives a summary of the remote turns as `additionalContext`.

### What Claude says between tool calls (as built)

Hooks carry only a turn's last message (`Stop.last_assistant_message`). To show the same conversation as the editor,
the Local Agent follows the session's transcript (`transcript_path` from every hook payload; `TranscriptTail`). At each
hook it reads the lines appended since the last one and reports each main-thread assistant **text** block as
`agent.output`, before the hook's own event, so text and tool calls keep the editor's order.

- Data minimisation is unchanged: only Claude's text blocks leave the PC, as its final reply already did. Thinking, tool
  inputs/results, subagent (sidechain) lines and everything else in the file are ignored; tools still go through the
  hook summaries.
- It starts at the end of the file when it first sees a session (no history replay), reads at most 2 MB per hook, waits
  for incomplete lines, and dedupes by line uuid and against Stop's copy of the last message.
- Turns run by wake are already reported from the SDK stream; after each one the reader skips to the end of the file.
- The other direction is not possible: the VS Code extension has no API to show messages it didn't send. Turns sent from
  Pocket Agent are in the session's transcript (resume the conversation in VS Code to see them), and the next prompt typed
  there gets their summary (see "Waking idle observed sessions").

### M5 implementation notes (as built)

- **Two switches, both needed.** `pocket-agent approvals enable` on the PC (off by default, enforced there) allows remote
  decisions at all. **Away mode**, set from the dashboard, applies only to sessions the user started. Without it Claude
  Code asks on the PC as usual. Managed sessions use remote approval whenever the PC allows it, because no person is at their prompt.
- **Lifecycle.** The decision is stored once (compare-and-set), sent to the PC, and becomes `Approved`/`Denied` only on the PC's
  `applied` ack. A late decision becomes `Cancelled`. Every decision and application is in `AuditLog`.
- **Hook timing.** The installer gives the PermissionRequest hook a 330 s timeout. The PC waits at most 300 s, then answers nothing,
  and Claude Code falls back to its own prompt.
- **Claude Code facts that shape this** (from the docs, 2026-11-20):
  - Interactive sessions, including VS Code, run hooks only in folders the user has **trusted**; `-p`/SDK sessions always do.
  - VS Code starts in **Auto** permission mode (v2.1.283+), where a classifier approves most actions, so permission requests,
    and with them remote approvals, are rarer there than in Manual mode.
  - **Verified live in VS Code (2026-11-20, extension 2.1.326, Manual mode, trusted folder):** with Away mode on, the
    request was held (+0.13 s after the tool call). VS Code raised its own permission notification about 6 s later,
    so the request stayed answerable on the PC as well. Allow in the dashboard reached the PC in 16 ms, and the command ran
    about 0.23 s after the click. With Away mode off, the request was not held and VS Code asked as usual.

## 4. Identity, pairing and trust

**Signing in.** Email + password (Argon2), or **Sign in with Google through Firebase Authentication** (project
`pocket-agent27`). Firebase only proves the Google account: the browser gets a Firebase ID token from the Google popup
(or a full-page redirect when popups are blocked), sends it to `POST /auth/google`, and signs out of Firebase at once.
The API verifies the token itself (RS256 against Google's `securetoken` certificates, audience/issuer = the project,
not expired, `sign_in_provider = google.com`, verified email), then starts the usual httpOnly session cookie. The
Google account (Firebase uid) maps to one user. On first use, an existing account with the same Google-verified email
is linked (audited as `user.google_linked`), otherwise a new account is created when sign-ups are open. Google-only
accounts have no password. Config: `FIREBASE_PROJECT_ID` on the API (unset = Google sign-in off), and the existing
`NEXT_PUBLIC_FIREBASE_*` values (plus optional `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`) on the web. Every web origin must be
listed in Firebase Auth → Authorized domains.

1. A logged-in user clicks **Add device**. The API creates a pairing code: 8 characters from the
   Crockford base32 alphabet, valid for 10 minutes, single use, stored as a hash, and rate-limited.
2. The user runs `pocket-agent pair <code>` on the PC. The agent calls `POST /devices/pair` with the code,
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
- Pocket Agent never sends `updatedPermissions` (no "always allow" rules created remotely in the MVP) and
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
pocket-agent/
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

- Observed sessions receive an instruction while idle only with the wake opt-in, and the editor doesn't show those turns
  live (it gets a summary with its next prompt). They cannot be interrupted remotely.
- Discovery of sessions without Pocket Agent hooks depends on an undocumented Claude Code file. It is best-effort.
- Approvals for observed sessions are bounded by the hook timeout. Requests that expire fall back to the local prompt.
- Push notifications are best-effort. On iOS they require installing the PWA.
- Remote Control (official, Anthropic-hosted) already exists for some of these needs. Pocket Agent's
  advantages are approvals, multi-session overview and notifications on the user's own infrastructure.
