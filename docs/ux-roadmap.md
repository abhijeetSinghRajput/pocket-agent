# Pocket Agent — UX roadmap (2026-11-24)

The owner asked for every improvement from the UX review, one milestone at a time. Each milestone
ships complete (code, tests, checks, APK on the `mobile-preview` release; PC agent release when it
changes), then waits for the owner's go-ahead before the next.

## M1 — Reliability you can feel
- **Connection strip**: a thin "Reconnecting…" strip when live updates are down (tab screens and
  chats), so a quiet app is never mistaken for a stuck one.
- **Optimistic message**: a sent message shows in the chat at once (with a clock), before the
  server answers.
- **Retry**: a message that could not be sent stays in the chat, marked "Not sent · Tap to retry"
  (same idempotency key, so it can never run twice).

## M2 — Faster permission decisions
- **Allow for this session**: besides Allow / Deny, allow this kind of action for the rest of the
  session (Claude Code's session permission rules), from the app and the notification.
- **Context**: the full command and what Claude says it is for. Edits show the file path only: the
  owner decided code stays on the PC (2026-11-24).
- **Allow all**: several requests waiting → decide them together.

## M3 — Fewer taps
- **Recent workspaces** at the top of New chat: one tap to start (from your latest chats, only
  folders an online PC still allows).
- **Quick replies** above the empty message box when Claude finishes ("Continue", "Run the tests",
  "Commit this", "Explain what you changed"): one tap sends it.
- **Voice input**: dictate a message (a mic beside Send, in chats and New chat). It uses the
  phone's own speech service, the one the keyboard's mic uses; the microphone permission is asked
  the first time and is used only while the mic is on.

## M4 — Clearer feedback
- **Turn summary card** when Claude finishes: files changed, commands run, duration.
- **Live agent progress** in the agent map: what each running agent is doing now.

## M5 — Setup
- **Pair with a QR code**: the PC shows a code, the app scans it (no typing).
- **Health check** in Profile: PC online, hooks installed, push on, agent version — each with a fix.

## M6 — Polish
- **Haptics** on long-press, swipe-dismiss and tab switch.
- **Pin and archive chats**.
- **Search inside a chat**.
