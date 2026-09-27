# COLONY v1.0 Beta — Deployment

## Required services
COLONY needs three things:
1. a Node.js host that exposes the Next.js app over public HTTPS;
2. PostgreSQL;
3. a Telegram bot token from `@BotFather`.

The app cannot run purely as a file sent through Telegram. Telegram opens an HTTPS web application inside its Mini App webview.

## Required environment variables
```text
BOT_TOKEN
BOT_USERNAME
NEXT_PUBLIC_BOT_USERNAME
DATABASE_URL
APP_URL
TELEGRAM_WEBHOOK_SECRET
CRON_SECRET
ADMIN_TELEGRAM_IDS
ALLOW_DEV_AUTH=false
```

`APP_URL` is the public HTTPS origin without a trailing route, for example `https://colony.example.com`.

The helper scripts load `.env.local` and `.env` from the project root, with exported environment variables taking precedence. Set `NODE_ENV=production` when using `.env.production` files. Never commit these files.

`NEXT_PUBLIC_BOT_USERNAME` must be set **before building** because Next.js embeds it in browser code. Changing it requires a new build. For Docker, pass `--build-arg NEXT_PUBLIC_BOT_USERNAME=your_bot`; the Compose example accepts the same variable from the host or Compose `.env` file.

## First production bootstrap
After the environment is configured:
```bash
npm ci
npm run typecheck
npm run db:init
npm run doctor
npm run telegram:webhook
npm run build
npm start
```

`npm run doctor` verifies required environment variables, PostgreSQL connectivity and Telegram `getMe`.

With Docker Compose, edit the example environment values first, then initialize the database before starting the app:

```bash
docker compose -f docker-compose.example.yml build
docker compose -f docker-compose.example.yml run --rm app npm run db:init
docker compose -f docker-compose.example.yml up -d
```

The database initializer runs the cumulative schema in a transaction and can be rerun safely.

For an existing v1.0 database, apply `db/migrations/011_v1_0_1.sql` before deploying v1.0.1; it preserves fractional passive income between requests. For an existing v0.9 database, apply `010_v1_0_beta.sql` first. Fresh installations already include both changes in `db/schema.sql`.

## Notification cron
Call:
```text
POST /api/cron/notifications
Authorization: Bearer <CRON_SECRET>
```
roughly once per minute. A slower schedule works but produces later completion notifications.

## BotFather
After the HTTPS app is live:
1. open `@BotFather`;
2. select the bot;
3. configure its Main Mini App/Web App using `APP_URL`;
4. optionally configure the bot menu button to launch the app;
5. set the public bot username in `NEXT_PUBLIC_BOT_USERNAME`;
6. open `https://t.me/<bot_username>?startapp` from Telegram and test a real signed session.

## Initial beta sequence
Do not invite users immediately after the first successful page load.
1. Apply database schema.
2. Verify `/api/health`.
3. Run `doctor`.
4. Configure webhook.
5. Test one Star invoice with a test/owner account.
6. Test payment recovery with no pending purchase.
7. Create one beta code from the Admin block.
8. Enable `beta_required`.
9. Test the code from a second Telegram account.
10. Invite the first 5–10 testers, then expand to 20–50 only after one day without critical errors.
