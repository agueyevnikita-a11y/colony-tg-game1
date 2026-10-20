# Changelog

## 1.9.0-beta.1 — Focused Screens and Reliable Rewards
- Split long primary tabs into compact task-focused subsections and paginated market orders.
- Collapsed detailed resource cards and completed-tutorial guidance; kept direct navigation, placement and Telegram Back aware of subsections.
- Preserved foundry selections when inspecting the city map and separated offers from owned cosmetics.
- Added local costs, shortages, deadlines, errors and outcomes for contracts, daily login, market orders and expeditions.
- Kept returned expedition cargo intact until it fits; saved exact receipts for collection retries without duplicate rewards.
- Corrected exhausted-contract waiting states and calculated quest reward totals from actual data.
- Preserved microsecond cosmetic acquisition keys when extending temporary rewards and aligned quest/season claim lock ordering with production.
- Retained economy prices, random expedition outcomes, paid work and ownership; no new migration is required from v1.8.

## 1.8.0-beta.1 — Colony Events
- Added four building-specific colony situations with explicit costs, rewards and a free resolution.
- Connected a foundry resolution to thermal recovery research and linked event cards to buildings and technologies.
- Unlocked events after the initial tutorial; pending events do not expire, accumulate offline or reduce production.
- Added a 12-hour cooldown after resolution, persistent outcomes and atomic, idempotent server settlement.
- Showed resource shortages, storage limits and request errors beside the relevant choice.
- Added the colony event schema and migration `013_v1_8_colony_events.sql`; existing progress, paid jobs and entitlements are retained.

## 1.7.0-beta.1 — Research Goals
- Added a player-selected research goal with an ordered, deduplicated prerequisite path and remaining research cost/time.
- Excluded completed and already paid active research from future charges while retaining their visible progress.
- Added direct links to missing HQ/lab upgrades, prerequisites, resource production and unlocked buildings/recipes.
- Adapted the home guide to building timers, active research, selected goals and a fully completed technology tree.
- Moved research before the building catalog and improved repeat navigation and keyboard focus.
- Preserved research effects, prices, paid jobs, tutorial rewards and player progress; no new database migration is required.

## 1.6.0-beta.1 — Cosmetics and Focused Tabs
- Replaced the repeated colony-name header with COLONY and contextual section titles, with the full resource overview and guide on the city screen.
- Added visual previews for the existing Stars products and collection controls for applying or removing cosmetics.
- Displayed neon, aurora, orbital and founder appearances on the city and profile, sharing the rendering with shop previews.
- Added a dedicated illustrated founder monument without changing existing product contents or prices.
- Serialized cosmetic equipment changes and preserved precise PostgreSQL acquisition timestamps when selecting owned items.
- Retained player progress and existing entitlements; no new migration is needed from v1.4/v1.5.

## 1.5.0-beta.1 — Colony Interface and First Steps
- Added illustrated city buildings from a shared image atlas, a colony arrival illustration and consistent SVG icons for resources and actions.
- Reworked the mobile resource bar, city catalog, building inspector, production and research presentation.
- Added a welcome screen, actionable first-step guidance, construction waiting states and an in-game mechanics reference.
- Added subtle city activity, construction and selection animations, with reduced-motion support.
- Preserved tutorial step order, conditions and rewards, existing player progress and all economy formulas.
- Required no new database migration from v1.4; databases on v1.3 still need migration `012_v1_4_recipes.sql`.

## 1.4.0-beta.1 — Production Recipes
- Added research-gated precision and industrial casting recipes, trading ore, energy, time and queue capacity.
- Combined recipe choice with existing smelting modes, adjacency discounts, research output and batch previews.
- Added direct navigation between locked recipes, their technologies and unlocked production choices.
- Stored the recipe on each paid job; preserved existing costs, rewards and completion times.
- Added migration `012_v1_4_recipes.sql` and readiness validation for `foundry_jobs.recipe_key`; apply the schema before deploying v1.4.

## 1.3.0-beta.1 — Research and Blueprints
- Made the technology tree visible before a laboratory is built, with named prerequisites, branches, active effects and feedback beside each action.
- Added deep drilling and photovoltaic arrays, unlocking advanced ore and energy buildings through server-checked blueprints.
- Reduced the introductory technology to 20 science, 300 credits and five minutes; retained fractional science income.
- Applied new technology and laboratory income only after their actual completion, with regression coverage for offline intervals.
- Preserved existing technologies, buildings, stored jobs and research achievement progress; no database migration is required.

## 1.2.0-beta.1 — City Production
- Added individual foundry controls, economy/standard/rush modes, and serial batches that run offline.
- Added one selectable adjacency bonus: an active mine saves 15% ore or an active solar plant saves 20% energy. Map placement previews eligible cells.
- Added exact batch cost, output, duration, queue and warehouse previews near the production action.
- Preserved existing production jobs and retained completed output that cannot yet fit in storage.
- Added durable duplicate-request protection and PostgreSQL regressions for ownership, charging, concurrency and collection.
- Moved the city map and production above secondary home-screen cards; construction errors remain beside their actions.

## 1.1.0-beta.1 — Telegram Launch Preparation
- Added a clear Telegram entry screen, SDK retry, offline/expired-session recovery, safer request ordering and visibility-aware refresh.
- Added Telegram safe-area layout, back-button navigation and validated share links.
- Added `/start`, `/help` and `/paysupport` bot commands with bounded, sanitized Bot API requests.
- Notification write access now comes from signed Telegram data or an authenticated Telegram service update, never a client claim.
- Added production configuration validation, bot identity/webhook diagnostics and a preview/apply bot setup command.
- Added `/api/ready` for production configuration and schema readiness; release metadata now comes from one version source.
- Added production HTTP integration tests on PostgreSQL and deployment-image verification in CI.
- Updated deployment guidance and Docker defaults for the first Telegram closed test.

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
