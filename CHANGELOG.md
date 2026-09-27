# Changelog

## 1.0.1-beta.1 — Closed Beta Operations
- Added server-side maintenance mode and closed-beta access gate.
- Added limited-use beta invitation codes stored as SHA-256 hashes.
- Added global per-player API rate limiting plus stricter payment/feedback/beta-code limits.
- Added in-game feedback submission and admin review surface.
- Added idempotent Telegram Stars fulfillment helper shared by webhook and recovery.
- Added user-triggered Stars purchase recovery through `getStarTransactions`.
- Added handling/logging of Telegram refund notifications.
- Added richer `/api/health` status.
- Added `npm run db:init`, `npm run doctor` and `npm run telegram:webhook` deployment helpers.
- Added admin controls for maintenance, beta requirement and beta code generation.
- Added deploy and phone setup documentation for the first real closed beta.

# Changelog

## 0.9.0 — Closed Beta Build
- First-launch colony naming and editable public profile.
- Colony name used in public cities, leaderboards, alliance members, referrals and market seller identity.
- Seven-day daily-login reward cycle with current/longest streak tracking.
- Persistent in-game inbox with deduplicated system messages.
- Server-side feature flags with deterministic percentage rollout and per-user override foundation.
- Server enforcement for market, alliance create/join, expeditions and Stars invoices.
- Admin feature-flag controls and 24h error metrics.
- Client error telemetry plus session, webhook and notification-delivery error logging.
- `/api/health` database health endpoint.
- Dockerfile and example Docker Compose deployment configuration.
- Telegram purchase confirmations are mirrored into the in-game inbox.
- Closed-beta banner and beta-safe UX.

Earlier v0.1–v0.8 work is preserved in the repository history / previous release archives.
