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
| Local Agent → API | `device.connected`, `device.heartbeat`, `agent.session.started`, `agent.session.updated`, `agent.session.ended`, `agent.tool.started`, `agent.tool.completed`, `agent.tool.failed`, `agent.permission.requested`, `agent.permission.resolved`, `agent.output`, `agent.error`, `command.ack`, `approval.decision.ack` |
| API → Local Agent | `command.execute` (`instruction` / `session.start`), `command.stop`, `approval.decision` (`allow` / `deny` only), `device.revoke`, `config.update` (`remoteApprovalEnabled`, `awayMode`), `ack` |
| API → Web | `device.status.changed`, `agent.status.changed`, `agent.event.created`, `command.status.changed`, `approval.created`, `approval.updated`, `notification.created` |

`approval.decision` can carry only `allow` or `deny`. The protocol has no way to express "always allow"
or modified input, so AgentDock cannot weaken local Claude Code permissions.

## Status machines

These live in `packages/protocol/src/state-machines.ts` and are unit tested.

- **Agent:** Starting → Running ⇄ WaitingForPermission / WaitingForInput → Completed / Failed / Stopped. `Disconnected` can recover. `Stopped` is terminal.
- **Command:** Pending → Delivered → Accepted → Executing → Completed / Failed. `Expired` is possible only before execution starts.
- **Approval:** Pending → exactly one of Approved / Denied / Expired / Cancelled.
