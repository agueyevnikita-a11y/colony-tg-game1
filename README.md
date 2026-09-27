# COLONY v1.0.1 Beta

Telegram Mini App economic city-builder. v1.0.1 Beta is the launch-ready build intended for a small real-user closed test. The core game includes city construction, production, P2P market, seasons, achievements, cosmetics, alliances, megaprojects, research, expeditions, onboarding, Telegram completion notifications, profiles, daily streaks and an in-game inbox.

v1.0 adds the operational layer needed to run that test safely: maintenance mode, beta invite codes, server-side access gating, per-player API rate limits, player feedback, Stars purchase recovery, richer health checks and deployment helper scripts.

## Stack
- Next.js 16 / React 19 / TypeScript
- PostgreSQL via `postgres`
- Telegram Mini Apps + Bot API + Telegram Stars

## Local start
Requires Node.js 22.15 or newer and PostgreSQL 16.

```bash
cp .env.example .env.local
npm ci
npm run typecheck
npm test
npm run db:init
npm run dev
```

For an existing v0.9 database, apply `db/migrations/010_v1_0_beta.sql` and then `db/migrations/011_v1_0_1.sql`. Existing v1.0 databases need the latter migration. For a fresh database, `npm run db:init` applies the cumulative `db/schema.sql`. Fractional production is persisted so frequent session refreshes do not discard passive income or science.

## Production bootstrap
After setting production environment variables:
```bash
npm run db:init
npm run doctor
npm run telegram:webhook
npm run build
npm start
```

Useful endpoints:
- `GET /api/health` — database + maintenance/beta status
- `POST /api/telegram/webhook` — Telegram payments/refunds
- `POST /api/cron/notifications` — due Telegram notifications
- `POST /api/payments/recover` — authenticated Stars recovery
- `POST /api/beta/redeem` — closed-beta code activation
- `POST /api/feedback` — in-game beta feedback

## Closed beta controls
Admin Telegram IDs are configured with `ADMIN_TELEGRAM_IDS`. In the in-game Admin block an administrator can:
- enable/disable maintenance mode;
- require or disable beta access;
- generate limited-use beta invite codes;
- operate feature flags;
- review recent feedback and aggregate test metrics.

Beta codes are stored only as SHA-256 hashes. A generated code is returned to the admin once and then cannot be reconstructed from the database.

## Telegram launch
Once the app has a public HTTPS URL, configure the bot's Main Mini App in `@BotFather`. The shareable form is:

```text
https://t.me/YOUR_BOT_USERNAME?startapp
```

Referral/game start parameters continue to use the same Main Mini App link, for example `?startapp=ref_123456` and `?startapp=ally_CODE`.

See:
- `docs/DEPLOY_v1.0.md`
- `docs/PHONE_SETUP_v1.0.md`
- `docs/RELEASE_CHECKLIST_v1.0.md`
- `docs/GAME_DESIGN_v1.0.md`
