# AgentDock

> Your agents. Your machines. Your control.

AgentDock is a remote command center for AI coding agents (starting with Claude Code) that run on your
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

### Pair this PC (local development)

```bash
pnpm --filter @agentdock/local-agent build
# In the dashboard: create an account → Devices → Add device → copy the code, then:
pnpm agentdock pair ABCD-EFGH --api http://localhost:4000
pnpm agentdock start        # stays in the foreground; Ctrl+C to stop
pnpm agentdock status       # shows pairing state; other commands: rotate, unpair
```

Credentials are stored in `%APPDATA%\AgentDock` and the device secret is encrypted with Windows DPAPI.
Set `AGENTDOCK_HOME` to use a different folder.

Quality gate (run before closing any milestone):

```bash
pnpm check                 # prettier --check, typecheck, lint (zero warnings), unit tests
pnpm test:integration      # API against real Postgres + Redis (needs infra:up + db:migrate)
pnpm test:e2e              # Playwright: desktop, mobile and 360px viewports (first: pnpm --filter @agentdock/web exec playwright install chromium)
```

### Windows notes

- The web app builds with webpack (`next build --webpack`). On PCs with **Smart App Control /
  Application Control** turned on, Windows blocks Next's unsigned native Turbopack binary. The webpack
  build is officially supported and works there.
- If `corepack enable` fails with `EPERM`, run `corepack enable --install-directory "%APPDATA%\npm" pnpm`.

## Configuration

All deployment-specific settings come from environment variables, validated at startup. See each app's
`.env.example`. Real `.env` files are git-ignored. Never commit secrets or device credentials.
