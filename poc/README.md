# Claude Code integration — proof of concept

Throwaway code that validates the risky integration points before the real build. It is not part of the product.
Tested 2026-11-17: Claude Code 2.1.325 (VS Code bundled binary), Agent SDK 0.3.316, Windows 11, Node 24.

## claude-integration/ — hooks ("observed sessions")

- `relay.mjs`: the command run by every hook. It forwards stdin to the broker and prints the broker's
  reply. If the broker can't be reached, it prints nothing, so it never fails open.
- `broker.mjs`: a stand-in for the Local Agent, on 127.0.0.1:47821. It holds PermissionRequest open until
  `POST /approvals/:id`, and delivers queued instructions on `Stop`.
- `gen-settings.mjs` → `hooks.settings.json`, passed with `claude --settings <file>`. User settings are not touched.
- `drive-stop-injection.mjs`: plays the phone: deny → queue an instruction → approve.

Run: `node broker.mjs`, then in another directory
`claude -p "<prompt>" --model haiku --settings <abs path>/hooks.settings.json`.

### Results

| Check | Result |
|---|---|
| Session detected | ✅ `SessionStart` (source `startup`) with `session_id`, `cwd`, `transcript_path` |
| Events associated with the session | ✅ every hook carries `session_id`; observed order: SessionStart → UserPromptSubmit → PreToolUse → PermissionRequest → PostToolUse → Stop → SessionEnd |
| Permission request received | ✅ PermissionRequest fires in `-p` mode; the session blocks while the hook waits |
| Remote allow | ✅ the command ran |
| Remote deny | ✅ the command did not run; it appears in `permission_denials` |
| Replayed decision | ✅ rejected (409) |
| New instruction into the same session | ✅ Stop hook `{"decision":"block","reason":"…"}` → Claude continued in the **same** session_id and ran the new instruction (which needed and received a new approval) |
| Passive discovery | ✅ `~/.claude/sessions/<pid>.json` lists live sessions (`sessionId`, `cwd`, `status`, `entrypoint: claude-vscode`). Undocumented. The neighbouring `*.key` files and `~/.claude/ide/*.lock` files hold auth tokens and must never be read |

Limitation: Stop-hook delivery happens only when a turn ends. An idle session can't be woken.

## sdk-managed/ — Agent SDK ("managed sessions")

`managed-session.mjs`: one `query()` with an async-generator prompt and a `canUseTool` that decides after a
simulated 2 s remote delay.

| Check | Result |
|---|---|
| 3 instructions, sent at different times, into one session | ✅ a single session_id across all turns |
| Async approval (allow) | ✅ |
| Async approval (deny) | ✅ the file was not created; Claude reported the denial |

Conclusion: managed sessions give full control through supported APIs. A PTY wrapper is unnecessary.
