# WebSocket events

Defined and validated in `packages/protocol/src/events.ts`. The schemas exist from M1; the
gateway that carries them is built in M2 (`/ws/agent`) and M3 (`/ws/client`).

## Envelope

```ts
{ v: 1, eventId: uuid, eventType: string, timestamp: ISO-8601,
  deviceId?: string, sessionId?: string, payload: {...} }
```

- The envelope is strict: unknown top-level fields are rejected.
- `eventId` is the dedupe key. Delivery is at-least-once, with an `ack` for each event.
- Frames over 256 KB are dropped. Text fields inside payloads are capped at 8 KB and truncated on the PC.
- Invalid frames are dropped and counted. The connection is not crashed.

## Catalogue

| Direction | Events |
|---|---|
| Local Agent → API | `device.connected`, `device.heartbeat`, `agent.session.started`, `agent.session.updated`, `agent.session.ended`, `agent.tool.started`, `agent.tool.completed`, `agent.tool.failed`, `agent.permission.requested`, `agent.permission.resolved`, `agent.output`, `agent.error`, `agent.sessions.snapshot`, `device.settings`, `command.ack`, `approval.decision.ack` |
| API → Local Agent | `command.execute` (`instruction` / `session.start` / `interrupt` / `session.stop`), `approval.decision` (`allow` / `deny` only), `device.revoke`, `config.update` (`remoteApprovalEnabled`, `awayMode`), `ack` |
| API → Web | `device.status.changed`, `agent.status.changed`, `agent.event.created`, `command.status.changed`, `approval.created`, `approval.updated`, `notification.created` |

`approval.decision` can carry only `allow` or `deny`. The protocol has no way to express "always allow"
or modified input, so AgentDock cannot weaken local Claude Code permissions.

## Sessions (M3)

- Session events (`agent.session.*`, `agent.tool.*`, `agent.permission.*`, `agent.output`, `agent.error`)
  **must** carry `sessionId`, which is the provider's `externalSessionId`. Frames without it are invalid and not acknowledged.
- The API acknowledges a session event only after it has been stored. The agent keeps unacknowledged events in an in-memory
  outbox (10 000 maximum) and replays them in order after each reconnect. `AgentEvent.eventId` is unique, so a replay is a no-op.
- `agent.session.started` is an upsert keyed by `(deviceId, externalSessionId)`. Sending it again updates the
  description (capabilities, metadata) and reopens an ended session (resume). It never creates a duplicate.
- After every connect the agent sends `agent.sessions.snapshot {sessions:[{externalSessionId,status}]}`. Listed
  sessions get that status. Every other open session of the device is ended (`Stopped`), because the PC no longer knows it.
- When a device's link drops, its open sessions become `Disconnected` until the next snapshot.
- An event for a session the API was never told about is acknowledged and dropped.
- `agent.permission.resolved.outcome`: `local` = answered on the PC, `auto_denied` = denied because no approval channel
  exists yet (managed sessions before M5; never auto-allowed), `remote` / `timeout` / `cancelled` arrive in M5.

## Approvals (M5)

- The PC holds a request only when the owner enabled it (`agentdock approvals enable`) and, for sessions the user
  started, only in Away mode. It then sends `agent.permission.requested` with `awaitingRemote: true` and `expiresAt`, and the API opens
  an approval.
- `approval.decision {approvalId, requestId, decision, message?}` goes to the PC. The PC answers
  `approval.decision.ack {approvalId, result: "applied"|"stale"}`. Only `applied` makes it Approved or Denied.
- The decision is handed to Claude Code unchanged. Managed sessions get `canUseTool` → `allow` with the original input,
  or `deny` with a message. Sessions the user started get the PermissionRequest hook output `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`.
  AgentDock never sends `updatedInput` (managed sessions get the input back unchanged) or `updatedPermissions`.
- No decision in time: managed sessions deny after 10 minutes. Sessions the user started answer nothing after 5 minutes, so Claude Code
  asks on the PC. A request answered on the PC meanwhile releases the wait (`outcome: "local"`).
- `config.update {awayMode}` goes to the PC after every connect and on change.

## Commands (M4)

- `command.execute {commandId, commandType, …, expiresAt}`: session-scoped commands name the target in the envelope's
  `sessionId` (the `externalSessionId`). The API sends it to whichever instance holds the device's socket, using Redis
  pub/sub. When the PC reconnects, commands still `Pending` are sent again.
- The PC runs each `commandId` at most once, drops anything past `expiresAt`, and checks its local policy (project allow-list,
  observed-instructions switch) **before** anything runs. It reports progress with `command.ack {commandId, status, error?, externalSessionId?}`,
  which goes through the same outbox as session events. The API applies a report only if it moves the command forward in the state
  machine, and only for the device that owns the command.
- `device.settings {projects, observedInstructions}` is sent after every connect and whenever the PC policy changes. The
  backend stores it for display only.
- **Observed sessions** get instructions through the Stop hook. When Claude finishes a turn, the relay answers
  `{"decision":"block","reason":"New instruction from the user, sent remotely through AgentDock: …"}` and Claude continues
  in the same session. The next Stop marks the instruction `Completed`. This is the only hook AgentDock ever answers.
- **Managed sessions** run one instruction per turn. An instruction sent mid-turn waits for the turn to end, or for `interrupt`.

## `/ws/client` (browser, M3)

Server → browser only. The Origin is checked, and a session cookie is required. Frames are `BackendToWeb` events that say *what changed*
(`device.status.changed`, `agent.status.changed`, `agent.event.created` with `sessionId`), and the dashboard then re-fetches
over REST. Events fan out to every API instance through Redis pub/sub. The socket closes with `4401` when that login
session signs out.

## `/ws/agent` link behaviour (M2)

| Aspect | Behaviour |
|---|---|
| Auth | The `AgentDock-Device` header is checked **before** the upgrade (`401` otherwise). Browsers can't set this header on WebSockets. |
| First frame | The agent sends `device.connected` (version, platform, hostname). The API acks it and the device turns **Online**. |
| Heartbeat | The agent sends `device.heartbeat` every 15 s and the API acks each one. Any `deviceId` in the envelope must match the authenticated device; a mismatch counts as an invalid frame. |
| Liveness | The API pings every 15 s and terminates connections that don't answer. The agent reconnects if it hears nothing for 3 heartbeat intervals. A sweeper marks devices **Offline** 45 s after their last heartbeat, which also covers a crashed API instance. |
| Invalid frames | More than 10 per connection closes it with `1008`. Frames over 256 KB are closed by the WebSocket layer. |
| One connection per device | A newer connection closes the older one with `4001`, and that agent process exits instead of fighting for the slot. |
| Revocation | The API sends `device.revoke` and then closes with `4003`. This reaches every instance through Redis pub/sub, with a database check on the next heartbeat as a fallback. The agent deletes its credentials and never reconnects. |
| Reconnect | Exponential backoff with full jitter (1 s → 30 s cap, minimum 250 ms). It stops on `401`, `4001` or `4003`. |

## Status machines

These live in `packages/protocol/src/state-machines.ts` and are unit tested.

- **Agent:** Starting → Running ⇄ WaitingForPermission / WaitingForInput → Completed / Failed / Stopped. `Disconnected` can recover. `Stopped` is terminal.
- **Command:** Pending → Delivered → Accepted → Executing → Completed / Failed. `Expired` is possible only before execution starts.
- **Approval:** Pending → exactly one of Approved / Denied / Expired / Cancelled.
