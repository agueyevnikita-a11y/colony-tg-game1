# COLONY v1.8 Beta

Telegram Mini App economic city-builder. v1.1 prepares the existing game for a real Telegram closed test. The core game includes city construction, production, P2P market, seasons, achievements, cosmetics, alliances, megaprojects, research, expeditions, onboarding, Telegram completion notifications, profiles, daily streaks and an in-game inbox.

v1.1 adds Telegram entry and recovery screens, safer session refresh, bot commands, deployment validation and a production readiness endpoint. The beta operations from v1.0 remain: maintenance mode, invite codes, rate limits, feedback and Stars purchase recovery.

v1.2 makes city planning affect production: select a foundry, choose a smelting mode and one neighboring supplier bonus, and queue several cycles with an exact cost/time/output preview. The city map and production controls come first on the home screen. Existing jobs keep their stored costs, output and completion times; completed output waits in the workshop when the warehouse is full. No additional database migration is required from v1.1. See [production rules and verification](docs/PRODUCTION_v1.2.md).

v1.3 connects research to city development. Three branches show requirements, running work and applied effects before a laboratory is available. Deep drilling and photovoltaic arrays unlock advanced resource buildings, while existing technologies retain their bonuses. New effects begin at their actual completion time. No migration is required from v1.2. See [research rules and blueprints](docs/RESEARCH_v1.3.md).

v1.4 adds research-gated production recipes: save ore with precision casting or save energy per part with industrial casting. Recipes combine with foundry modes and adjacency. **Apply `npm run db:init` (or migration `012_v1_4_recipes.sql` on v1.3) before deploying this version.** See [recipe rules and upgrade steps](docs/RECIPES_v1.4.md).

v1.5 refreshes the mobile interface with illustrated city buildings, consistent resource icons, a welcome screen, guided first steps and an in-game mechanics reference. Construction, production and research retain their existing rules; tutorial rewards and progression are preserved. City activity animations respect reduced-motion preferences. No additional migration is required from v1.4; upgrading from v1.3 still requires the v1.4 recipe migration above. See [interface scope and verification](docs/FRONTEND_v1.5.md) and [art assets](docs/ART_v1.5.md).

v1.6 gives each tab a compact contextual header and keeps the full resource overview and guide on the city screen. Paid cosmetics now have visual previews, shared effects on the real city, profile frames and founder art. Owned cosmetics can be equipped or removed; server-side ownership, expiry and category exclusivity are preserved. No new database migration is required from v1.4/v1.5. See [cosmetics and interface rules](docs/COSMETICS_v1.6.md).

v1.7 adds a player-selected research goal with an ordered prerequisite path, remaining research costs and actionable HQ/laboratory/resource requirements. The home guide follows actual research and building status, while completed technologies link to their buildings or recipes. Goals are stored per player on the current device; choosing a plan never launches or pays for research. No migration or economy change is required. See [research planning and verification](docs/RESEARCH_PLAN_v1.7.md).

v1.8 introduces gentle colony events after the initial tutorial. Each situation offers explicit resource trades and a free resolution; one foundry option is unlocked by research. Pending events persist, production continues normally, and the next event becomes available 12 hours after resolution. Choices and rewards are saved on the server and retries cannot grant rewards twice. **Apply `npm run db:init` (or migration `013_v1_8_colony_events.sql` on v1.7) before enabling the feature.** Sessions remain usable without the table, but events stay hidden and readiness reports the missing schema. See [event rules and upgrade steps](docs/EVENTS_v1.8.md).

## Stack
- Next.js 16 / React 19 / TypeScript
- PostgreSQL via `postgres`
- Telegram Mini Apps + Bot API + Telegram Stars

## Local start
Requires Node.js 22.18 or newer and PostgreSQL 16.

```bash
cp .env.example .env.local
npm ci
npm run typecheck
npm test
npm run db:init
npm run dev
```

For browser-only development, explicitly set `ALLOW_DEV_AUTH=true` in `.env.local`. Production always requires signed Telegram identity. Keep real settings in ignored env files or your host's secret settings.

For an existing v0.9 database, apply `db/migrations/010_v1_0_beta.sql` and then `db/migrations/011_v1_0_1.sql`. Existing v1.0 databases need the latter migration. For a fresh database, `npm run db:init` applies the cumulative `db/schema.sql`. Fractional production is persisted so frequent session refreshes do not discard passive income or science.

## Production bootstrap
Follow [the v1.1 Telegram launch guide](docs/DEPLOY_v1.1.md) and set production variables first, including `NEXT_PUBLIC_BOT_USERNAME` **at build time**:
```bash
npm ci
npm run doctor -- --local
npm run typecheck
npm test
npm run db:init
npm run build
npm start
```

Once the app is serving at its public HTTPS URL, preview bot configuration with `npm run telegram:setup`, apply it with `npm run telegram:setup -- --apply`, then run `npm run doctor`. Configure the Main Mini App separately in BotFather. See the launch guide for Docker, the notification cron, and real-device acceptance checks.

Useful endpoints:
- `GET /api/health` — database + maintenance/beta status
- `GET /api/health/live` — process liveness, independent of database configuration
- `GET /api/ready` — production config + required database schema; returns 503 until ready
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
- `docs/DEPLOY_v1.1.md`
- `docs/RELEASE_CHECKLIST_v1.1.md`
- `docs/DEPLOY_v1.0.md`
- `docs/PHONE_SETUP_v1.0.md`
- `docs/RELEASE_CHECKLIST_v1.0.md`
- `docs/GAME_DESIGN_v1.0.md`
