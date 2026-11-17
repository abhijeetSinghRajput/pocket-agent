# AgentDock

> Your agents. Your machines. Your control.

AgentDock is a remote command center for AI coding agents (starting with Claude Code) that run on your
own computer. From a phone or desktop browser you can watch sessions, approve permission requests and send instructions.

- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap and milestones: [docs/implementation-roadmap.md](docs/implementation-roadmap.md)
- Integration proof-of-concept: [poc/README.md](poc/README.md)

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js dashboard (responsive, PWA later) |
| `apps/api` | Fastify API + WebSocket gateway, Prisma/Postgres, Redis |
| `apps/local-agent` | PC-side agent and CLI |
| `packages/protocol` | Shared Zod schemas: WS envelope, events, DTOs, status machines |
| `packages/config` | Shared tsconfig and ESLint presets |
| `infrastructure/docker` | Local Postgres + Redis (dev only) |
| `poc/` | Throwaway integration experiments (not built or shipped) |

## Development setup

Prerequisites: Node.js ≥ 22.12, Corepack (bundled with Node), Docker Desktop.

```bash
corepack enable            # if this fails with EPERM on Windows: corepack enable --install-directory "%APPDATA%\npm"
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up              # Postgres 17 + Redis 7 on 127.0.0.1
pnpm db:migrate            # apply Prisma migrations
pnpm dev:api               # http://localhost:4000/health
pnpm dev:web               # http://localhost:3000
```

Quality gate (run before closing any milestone):

```bash
pnpm check                 # prettier --check, typecheck, lint, unit/integration tests
pnpm test:e2e              # Playwright (desktop + mobile viewports)
```

## Configuration

All deployment-specific settings come from environment variables, validated at startup. See each app's
`.env.example`. Real `.env` files are git-ignored. Never commit secrets or device credentials.
