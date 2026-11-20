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
| `agentdock-api` web service | Starter (paid) | It must never sleep, because PCs keep a WebSocket open to it. |
| `agentdock-db` Postgres | Basic 256 MB (paid) | Free Postgres databases are deleted after 30 days. |
| `agentdock-redis` Key Value | Free | It only holds rate-limit counters, pub/sub and WebSocket tickets, so nothing needs to persist. |

Vercel's Hobby plan is enough for the web app. Check current prices on render.com and vercel.com before creating anything.

## 1. API on Render

1. Push this repository to GitHub. Render reads `render.yaml` from it.
2. In Render: **New → Blueprint**, connect GitHub, pick the repository, and approve the three resources.
3. When it asks for **`WEB_ORIGINS`**, enter the Vercel URL, for example `https://agentdock-xyz.vercel.app` (no trailing slash). If you
   don't know the URL yet, enter a placeholder and fix it after step 2 of the web app section.
4. Go to **agentdock-api → Environment → Secret Files → Add**. Name the file `fcm.json` and paste the contents of the Firebase
   service-account JSON. Render mounts it at `/etc/secrets/fcm.json`, which `FCM_SERVICE_ACCOUNT_FILE` already points to.
   Without it, the API still runs, but notifications are in-app only.
5. Deploys run `prisma migrate deploy` before starting the new version. Check the API at
   `https://agentdock-api.onrender.com/health` (your service URL may differ).

## 2. Web on Vercel

1. In Vercel: **Add New → Project**, import the repository, and set **Root Directory** to `apps/web`. The install and build
   commands come from `apps/web/vercel.json`.
2. Add these environment variables (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `/api` |
| `API_PROXY_TARGET` | `https://agentdock-api.onrender.com` (your Render URL) |
| `NEXT_PUBLIC_WS_URL` | `wss://agentdock-api.onrender.com/ws/client` |
| `NEXT_PUBLIC_AGENT_API_URL` | `https://agentdock-api.onrender.com` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `…_PROJECT_ID`, `…_MESSAGING_SENDER_ID`, `…_APP_ID` | from the Firebase web app (the same values as `apps/web/.env.local`) |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Firebase → Project settings → Cloud Messaging → Web Push certificates |

3. Deploy. If the final `*.vercel.app` URL differs from what you put in `WEB_ORIGINS`, update it on Render. The API
   restarts with the new value.
4. `NEXT_PUBLIC_*` values and `API_PROXY_TARGET` are read at **build** time. After changing them, redeploy.

## 3. First sign-in and lock-down

1. Open the Vercel URL on your phone and create your account.
2. On Render, set `REGISTRATION_ENABLED=false`, so nobody else can sign up on your instance.
3. **Settings → Notifications → Enable push on this device → Send test notification.**
   On iPhone, first use Share → **Add to Home Screen**, then open AgentDock from the Home Screen.

## 4. Point your PC at it

```bash
pnpm --filter @agentdock/local-agent build
pnpm agentdock unpair                      # if it was paired with your local API
pnpm agentdock pair <CODE> --api https://agentdock-api.onrender.com
pnpm agentdock start
```

The **Add device** dialog in the deployed dashboard shows this command with the right URL.

## Environment reference

API: see `apps/api/.env.example`. In production, `WEB_ORIGINS` must be `https://` URLs, `COOKIE_SECURE` defaults to
true, and `RATE_LIMIT_SCALE` can't exceed 1. Web: see `apps/web/.env.example`.
