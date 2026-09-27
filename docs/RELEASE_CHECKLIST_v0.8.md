# COLONY v0.8 — Closed Test Release Checklist

## Database
- Apply migrations in order through `008_v0_8.sql`.
- Verify `notification_preferences`, `notification_jobs` and `tutorial_claims` exist.
- Verify existing accounts keep their prior resources and buildings.

## Environment
Required:
- `DATABASE_URL`
- `BOT_TOKEN`
- `NEXT_PUBLIC_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`
- `CRON_SECRET`
- `ADMIN_TELEGRAM_IDS` (comma-separated Telegram numeric IDs)

## Telegram
- Configure the bot Main Mini App in BotFather.
- Set the Bot API webhook to `/api/telegram/webhook` with the webhook secret.
- Test the native write-access request from an actual Telegram client.
- Confirm the bot can send a private `sendMessage` after permission is granted.

## Notifications
- Run `/api/cron/notifications` at least once per minute with `Authorization: Bearer <CRON_SECRET>`.
- Start one building timer and verify a single delivery after completion.
- Run the cron endpoint concurrently twice and verify no duplicate delivery.
- Disable notifications and verify pending unsent jobs are cancelled.

## Tutorial
Test on a fresh account:
- welcome reserve;
- foundry construction;
- first smelt;
- trade hub;
- NPC contract;
- HQ2;
- permanent tutorial title.

## Admin
- Confirm non-admin receives HTTP 403 from `/api/admin/dashboard`.
- Confirm admin sees aggregate metrics.
- Verify abuse signals do not perform automated enforcement.

## Build
Before real deployment:
- `npm install`
- `npm run typecheck`
- `npm run build`

The repository currently passes the standalone TypeScript syntax transpilation check; a full Next.js build still requires installed dependencies.
