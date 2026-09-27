# Release checklist — v0.4

1. Set `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_BOT_USERNAME`.
2. Apply `db/schema.sql` for a fresh DB, or migrations `002`, `003`, `004` in order for an existing v0.1 DB.
3. Install dependencies with `npm ci` (or `npm install` if no lockfile exists yet).
4. Run `npm run typecheck` and `npm run build`.
5. Configure the bot Web App URL and Telegram webhook.
6. Test two separate Telegram accounts: seller and buyer.
7. Verify escrow: create order → resources decrease; cancel → resources return.
8. Verify partial buy and 5% seller fee.
9. Verify buyer storage-cap rejection.
10. Verify Season I points and one-time reward claims.
11. Check `analytics_events`, `market_trades`, `economy_daily_snapshots` after the test.

Do not enable real promotion until steps 6–11 pass on the deployed database.
