# Deployment (M7): Render (API) + Vercel (web)

```
 Phone / desktop browser
   │  https://<web>.vercel.app            pages, and /api/* → proxied to the API (first-party cookie)
   │  wss://<api>.onrender.com/ws/client  live updates, opened with a one-time ticket
   ▼
 Vercel (Next.js) ──/api/*──▶ Render web service (Fastify API) ──▶ Render Postgres 17
                                     ▲                       └──▶ Render Key Value (Redis)
 Windows PC (Local Agent) ──wss──────┘  device credentials, no cookies
```

The two free domains are different sites, and Safari/iOS block third-party cookies. So the dashboard calls the API
through its own `/api` path, which makes the login cookie first-party. WebSockets can't go through Vercel. Instead, the
page asks `POST /api/ws/tickets` for a single-use ticket that lasts 60 seconds and connects straight to Render with it.

## Costs (Render, Singapore region)

| Resource | Plan | Why |
|---|---|---|
| `pocket-agent-api` web service | **Free** (testing) → Starter for real use | Free instances sleep after 15 minutes without traffic and wake in about a minute. The PC agent's heartbeat usually keeps the instance awake, but that isn't guaranteed. Migrations run at start-up, because free instances have no pre-deploy step. |
| `pocket-agent-db` Postgres | **Free** (testing) → Basic 256 MB for real use | **Render deletes free databases after 30 days**, including accounts, paired PCs and history. Before you rely on it, upgrade the plan or point `DATABASE_URL` at an external Postgres such as Neon or Supabase. |
| `pocket-agent-redis` Key Value | Free | It only holds rate-limit counters, pub/sub and WebSocket tickets, so nothing needs to persist. |

Vercel's Hobby plan is enough for the web app. Check current prices on render.com and vercel.com before creating anything.

## 1. API on Render

1. Push this repository to GitHub. Render reads `render.yaml` from it.
2. In Render: **New → Blueprint**, connect GitHub, pick the repository, and approve the three resources.
3. When it asks for **`WEB_ORIGINS`**, enter the Vercel URL, for example `https://pocket-agent-xyz.vercel.app` (no trailing slash). If you
   don't know the URL yet, enter a placeholder and fix it after step 2 of the web app section.
4. Go to **pocket-agent-api → Environment → Secret Files → Add**. Name the file `fcm.json` and paste the contents of the Firebase
   service-account JSON. Render mounts it at `/etc/secrets/fcm.json`, which `FCM_SERVICE_ACCOUNT_FILE` already points to.
   Without it, the API still runs, but notifications are in-app only.
5. Each start runs `prisma migrate deploy` first (it only applies new migrations). Check the API at
   `https://pocket-agent-api.onrender.com/health` (your service URL may differ).

## 2. Web on Vercel

1. In Vercel: **Add New → Project**, import the repository, and set **Root Directory** to `apps/web`. The install and build
   commands come from `apps/web/vercel.json`.
2. Add these environment variables (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `/api` |
| `API_PROXY_TARGET` | `https://pocket-agent-api.onrender.com` (your Render URL) |
| `NEXT_PUBLIC_WS_URL` | `wss://pocket-agent-api.onrender.com/ws/client` |
| `NEXT_PUBLIC_AGENT_API_URL` | `https://pocket-agent-api.onrender.com` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `…_PROJECT_ID`, `…_MESSAGING_SENDER_ID`, `…_APP_ID` | from the Firebase web app (the same values as `apps/web/.env.local`) |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Firebase → Project settings → Cloud Messaging → Web Push certificates |

3. Deploy. If the final `*.vercel.app` URL differs from what you put in `WEB_ORIGINS`, update it on Render. The API
   restarts with the new value.
4. `NEXT_PUBLIC_*` values and `API_PROXY_TARGET` are read at **build** time. After changing them, redeploy.

## 3. First sign-in and lock-down

1. Open the Vercel URL on your phone and create your account.
2. On Render, set `REGISTRATION_ENABLED=false`, so nobody else can sign up on your instance.
3. **Settings → Notifications → Enable push on this device → Send test notification.**
   On iPhone, first use Share → **Add to Home Screen**, then open Pocket Agent from the Home Screen.

## 4. Connect a PC

On any PC with Node.js 24+ (no repository or pnpm needed):

```bash
npm install -g pocketagent
pocket-agent setup <CODE> --api https://pocket-agent-api.onrender.com
```

The **Add device** dialog shows these commands with the right code and URL. `setup` does four things:
- pairs the PC;
- connects Claude Code (installs the hooks);
- starts the agent in the background;
- on Windows, registers it to start at sign-in, using the per-user `Run` registry key, which needs no admin rights.

Day to day: `pocket-agent status`, `stop`, `start --background` and `autostart disable`. The log is in
`%APPDATA%\PocketAgent\agent.log`.

## 5. Publish the PC app to npm

```bash
pnpm --filter @pocket-agent/local-agent pack:npm      # bundles into apps/local-agent/npm/
cd apps/local-agent/npm
npm pack                                              # optional: inspect the tarball
npm login                                             # once
npm publish --access public
```

The package is built by `scripts/pack-npm.mjs`: the protocol, `ws`, `commander` and `zod` are bundled, and only the
Claude Agent SDK is a dependency. Use `--name <npm-name>` (or `POCKET_AGENT_NPM_NAME`) to publish under another name,
and set `NEXT_PUBLIC_AGENT_NPM_PACKAGE` in Vercel to match. Bump `version` in `apps/local-agent/package.json` for
each release.

## Environment reference

API: see `apps/api/.env.example`. In production, `WEB_ORIGINS` must be `https://` URLs, `COOKIE_SECURE` defaults to
true, and `RATE_LIMIT_SCALE` can't exceed 1. Web: see `apps/web/.env.example`.
