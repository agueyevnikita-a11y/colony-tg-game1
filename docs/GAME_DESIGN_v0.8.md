# COLONY — Game Design v0.8: Closed Test Readiness

## Goal
v0.8 is not a content expansion. It prepares the existing game loop for real Telegram users and measurable closed testing.

## Onboarding
Six ordered tutorial steps guide the first session without locking the player into a separate tutorial mode:

1. Claim command reserve.
2. Build the Foundry.
3. Start the first smelting job.
4. Build the Trade Hub.
5. Complete the first NPC contract.
6. Upgrade HQ to level 2.

The server derives completion from real game state. A user who already performed an action does not have to repeat it. Rewards are one-time and idempotent through `tutorial_claims`.

The one-time tutorial resource package is intentionally sized so a new account can reach HQ2 without depending on P2P market liquidity.

## Telegram notifications
Notifications are optional and operational only:

- construction / upgrade ready;
- research ready;
- expedition returned.

There are no promotional notifications in v0.8. The Mini App asks for Telegram write permission using the native Telegram permission flow. Notification preferences can then be disabled in-game.

Jobs are persisted in `notification_jobs`. A protected cron endpoint claims due jobs using row locking and sends them through the Bot API. A Telegram 403 disables future delivery for that user instead of retrying forever.

## Closed-test admin telemetry
The admin dashboard is visible only to Telegram IDs listed in `ADMIN_TELEGRAM_IDS` and includes:

- total/new/24h-active users;
- a calendar-day D1 proxy;
- tutorial funnel;
- Stars paid in the last 7 days;
- market trades and burned market fees;
- median credits, crystals and City Score;
- high-velocity activity signals for manual review.

Signals never auto-ban users in v0.8.

## Test questions
The first closed test should answer:

- What percentage of new users claim tutorial step 1?
- What percentage reach the Trade Hub?
- What percentage reach HQ2?
- How long does the tutorial path take in practice?
- How many players enable Telegram notifications?
- What is the approximate next-day return rate?
- Does the market create useful liquidity without runaway inflation?
- Which systems are actually opened during the first 24 hours?
