# Pocket Agent

> Your agents. Your machines. Your control.

Pocket Agent is a remote command center for AI coding agents (starting with Claude Code) that run on your
own computer. From a phone or desktop browser you can watch sessions, approve permission requests and send instructions.

- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap and milestones: [docs/implementation-roadmap.md](docs/implementation-roadmap.md)
- Integration proof-of-concept: [poc/README.md](poc/README.md)

## Repository layout

| Path                    | What it is                                                     |
| ----------------------- | -------------------------------------------------------------- |
| `apps/web`              | Next.js dashboard (responsive, PWA later)                      |
| `apps/api`              | Fastify API + WebSocket gateway, Prisma/Postgres, Redis        |
| `apps/local-agent`      | PC-side agent and CLI                                          |
| `packages/protocol`     | Shared Zod schemas: WS envelope, events, DTOs, status machines |
| `packages/config`       | Shared tsconfig and ESLint presets                             |
| `infrastructure/docker` | Local Postgres + Redis (dev only)                              |
| `poc/`                  | Throwaway integration experiments (not built or shipped)       |

## Development setup

Prerequisites: Node.js ≥ 24.7 (uses the built-in `crypto.argon2`), Corepack (bundled with Node), Docker Desktop.

```bash
corepack enable            # if this fails with EPERM on Windows: corepack enable --install-directory "%APPDATA%\npm"
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up              # Postgres 17 + Redis 7 on 127.0.0.1
pnpm db:migrate            # apply Prisma migrations
pnpm dev:api               # http://localhost:4000/health (binds 127.0.0.1; set HOST=0.0.0.0 to test from a phone on your LAN)
pnpm dev:web               # http://localhost:3000
```

### Install on a PC (users)

```bash
npm install -g @mrcodium/pocket-agent
pocket-agent setup <CODE> --api <API-URL>     # code and URL: dashboard → Devices → Add device
```

### Pair this PC (local development)

```bash
pnpm --filter @pocket-agent/local-agent build
# In the dashboard: create an account → Devices → Add device → copy the code, then:
pnpm pocket-agent pair ABCD-EFGH --api http://localhost:4000
pnpm pocket-agent start        # stays in the foreground; Ctrl+C to stop
pnpm pocket-agent status       # shows pairing state; other commands: rotate, unpair
```

Credentials are stored in `%APPDATA%\PocketAgent` and the device secret is encrypted with Windows DPAPI.
Set `POCKET_AGENT_HOME` to use a different folder.

### Connect Claude Code

```bash
pnpm pocket-agent hooks install   # once: lets sessions you start in VS Code / a terminal report activity
                               # (backs up ~/.claude/settings.json; observe-only; `hooks uninstall` reverts)
pnpm pocket-agent start           # sessions appear under Agents in the dashboard
pnpm pocket-agent run "Fix the failing test" --cwd C:\path\to\project   # start a managed session
pnpm pocket-agent sessions        # what the running agent sees; `stop-session <id>` stops a managed one
```

Without hooks, sessions you start yourself still appear, but with status only.

### Control from your phone (you decide on the PC what is allowed)

```bash
pnpm pocket-agent projects add C:\path\to\project   # folders where the dashboard may start managed sessions
pnpm pocket-agent projects list                     # (and `projects remove <folder>`)
pnpm pocket-agent instructions enable               # optional: allow instructions to sessions YOU started
pnpm pocket-agent instructions wake enable          # optional: run them at once when that session is idle
                                                 # (delivered when Claude finishes its current turn)
```

To answer Claude Code's permission requests from your phone:

```bash
pnpm pocket-agent approvals enable    # off by default; `approvals disable` turns it off again
pnpm pocket-agent hooks install       # re-run after upgrading, so the permission hook gets its longer timeout
```

Managed sessions then ask in the dashboard (**Approvals**). Sessions you start yourself ask there only while **Away mode** is on
(Devices). Unanswered requests fall back to the PC. Hooks run only in folders you've trusted in Claude Code.

Then, in the dashboard: **Agents → New session** starts Claude in an allowed folder. An agent's page lets you
send instructions, interrupt the current task, or end a managed session. These changes apply to a running agent immediately.

### Notifications and push

Notifications are always recorded and shown in the app (the bell, **Notifications**). To also get web push:

1. Web: fill the `NEXT_PUBLIC_FIREBASE_*` values in `apps/web/.env.local` (see `.env.example`).
2. API: set `FCM_SERVICE_ACCOUNT_FILE` in `apps/api/.env` to a Firebase service-account key **outside the repo**.
3. In **Settings → Notifications**, choose _Enable push on this device_, then _Send test notification_.

On iPhone, push works only from the Home Screen app (iOS 16.4+). See [docs/notifications.md](docs/notifications.md)
for the categories, quiet hours, privacy and platform limits.

Quality gate (run before closing any milestone):

```bash
pnpm check                 # prettier --check, typecheck, lint (zero warnings), unit tests
pnpm test:integration      # API against real Postgres + Redis (needs infra:up + db:migrate)
pnpm test:e2e              # Playwright: desktop, mobile and 360px viewports (first: pnpm --filter @pocket-agent/web exec playwright install chromium)
```

### Windows notes

- The web app builds with webpack (`next build --webpack`). On PCs with **Smart App Control /
  Application Control** turned on, Windows blocks Next's unsigned native Turbopack binary. The webpack
  build is officially supported and works there.
- If `corepack enable` fails with `EPERM`, run `corepack enable --install-directory "%APPDATA%\npm" pnpm`.

## Deployment

Render (API, Postgres, Redis) via [`render.yaml`](render.yaml) plus Vercel (web). See [docs/deployment.md](docs/deployment.md).

## Configuration

All deployment-specific settings come from environment variables, validated at startup. See each app's
`.env.example`. Real `.env` files are git-ignored. Never commit secrets or device credentials.
