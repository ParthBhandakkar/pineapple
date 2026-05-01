# PineApple

PineApple is a from-scratch MVP for the OpenCode agent SaaS described in `docs/`. It includes a Next.js dashboard, Prisma data model backed by PostgreSQL, token-based usage, marketplace agent deployment, Razorpay-ready billing, OpenRouter-ready chat execution, OpenCode session wiring, high-risk approval gates, logs, tasks, notifications, and an admin panel.

## Quick Start

```bash
npm install
docker compose up -d postgres redis opencode
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

Seeded accounts:

```text
User:  demo@agentsim.local / demo123
Admin: admin@agentsim.local / admin123
```

## Verification

```bash
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

`/api/health` now returns `503` when core dependencies are degraded and includes `modelProvider` status so invalid OpenRouter credentials are visible immediately.

The local and production stack now uses PostgreSQL through Prisma Client. `docker-compose.yml` starts PostgreSQL, Redis, OpenCode, the Next.js app, and Caddy for the production VM deployment. For local development outside Docker, the sample `.env` values target `127.0.0.1` so `docker compose up -d postgres redis opencode` is enough to back `npm run dev`.

## Environment

Copy or edit `.env` from `.env.example`.

```text
DATABASE_URL="postgresql://agentsim:change-me@127.0.0.1:5432/agentsim?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
SESSION_SECRET="replace-with-a-long-random-secret"
COOKIE_SECURE="false"
OPENROUTER_API_KEY=""
OPENROUTER_MODEL="openrouter/auto"
OPENCODE_SERVER_URL="http://127.0.0.1:4096"
OPENCODE_SERVER_USERNAME="opencode"
OPENCODE_SERVER_PASSWORD=""
RAZORPAY_KEY_ID=""
RAZORPAY_KEY_SECRET=""
RAZORPAY_WEBHOOK_SECRET=""
NEXT_PUBLIC_RAZORPAY_KEY_ID=""
```

Set `COOKIE_SECURE="true"` when serving behind HTTPS.

## Implemented Flows

- Auth: email/password registration, login, logout, HTTP-only session cookies.
- Free tier: token-count based, default monthly allocation, one default deployed agent.
- Subscriptions: Free, Basic, Professional, Business, Enterprise placeholders with editable admin limits.
- Tokens: subscription tokens reset monthly; purchased tokens are separate and consumed after subscription balance.
- Chat: OpenCode session first when configured; OpenRouter direct call when configured; local simulation fallback when no model key is set.
- Safety: only high-risk prompts pause for user approval.
- Marketplace: browse agents, deploy according to plan limits, locked non-default agents on free plan.
- Billing: Razorpay order creation and signature verification when keys are configured; mock completion otherwise.
- Admin: revenue/users/subscription metrics, editable plans, and recent system logs.

## Production Notes

- Provision real OpenRouter credentials so OpenCode and direct chat calls can return live model output.
- Add real OpenRouter and Razorpay credentials.
- Keep production secrets out of git (store them in an untracked `.env.production` on the VM or your secret manager).
- Put the app behind HTTPS and set `COOKIE_SECURE="true"`.
- If `FORCE_OPENCODE_ONLY="true"`, the health endpoint requires both database + OpenCode to be healthy.
- Add container/workspace isolation if the shared VM starts executing untrusted code, not just orchestrating sessions.
