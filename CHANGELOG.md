# Changelog

## 1.14.9-beta.1 — Turn Team Goals into Actions
- Unfinished alliance goals now open the matching building catalog, workshops or colony contracts. Viewing a destination spends nothing; completed goals retain their explicit contribution and reward checks.
- The weekly league leads to joint mining or alliance discovery. It explains when a previous alliance is still bound to this week's score, so a change of team does not promise ineligible points. Ended weeks keep the results-refresh path.
- Alliance technologies separate spendable shared science from the current operation's expected science, with a countdown and an explicit refresh when settlement is due. Opening joint mining brings its controls into view without starting an operation or paying for a shift.
- No migration, dependency, economy, reward or saved-city change is required.

## 1.14.8-beta.1 — Follow Every Find
- Expedition route details now show each possible main artifact, its actual per-flight chance and known collection count. Each find opens its own collection card, which is highlighted, focused and expanded without spending resources.
- Claim receipts bring the result into view and link saved artifacts to their collection cards, including event finds and history. Repeated items keep their quantities; no first-discovery or guaranteed-drop claim is invented.
- Full-slot messages lead directly to a returned expedition or active flights. Collection sources show flight duration beside per-flight odds, and the quantum lens identifies its sole main route. The general collection button now says it selects an expedition rather than launches one.
- Navigation respects reduced motion, clears targets on player or section changes and preserves manually collapsed details during background refresh. No migration, dependency, reward, probability, price or saved-city change is required.

## 1.14.7-beta.1 — From Finds to Flight Routes
- Each artifact's source now opens and focuses its exact expedition route, with the selected find's per-flight chance, launch price and access requirements visible together. A return button leads back to the collection.
- Locked routes can be inspected from the collection before opening expeditions. Research, HQ, centre, slot, resource and feature restrictions still block launch; viewing never starts a flight or spends resources.
- Route focus clears on ordinary navigation or player changes, respects reduced motion and does not steal focus during background refresh. No migration, dependency, economy or saved-city change is required.

## 1.14.6-beta.1 — Give Development a Purpose
- Connected the city guide to a concrete research step or selected supply stage. It shows the immediate cost, shortages, stage reward and optional resource help; prepaid foundry outputs reduce new production needs without becoming spendable stock. Supply stages accept partial deliveries without demanding storage for the whole stage.
- Added a production supply comparison: actual active mine and power income versus one selected workshop's uninterrupted recipe demand, including research and Premium. This explains raw-material bottlenecks without promising a completion time or changing rates.
- Completed route technologies now lead to expeditions and explain their real access, HQ and centre requirements. First-smelt and building-goal descriptions match the events that actually count.
- Closed seasonal-point farming through reversible listings and arbitrarily split player trades. Market statistics, achievements, fees, historical points and claimed rewards are preserved; other seasonal sources and reward thresholds are unchanged.
- Retained the permanent builder achievement's key and reward while changing its impossible 10,000-action target to a reachable 500 constructions or upgrades. Existing counters, claims and cosmetic ownership remain intact.
- Added a read-only numerical balance audit with explicit assumptions. Resource rates, prices, production timers, expedition outcomes, supply payouts, purchases and saved cities are preserved; no migration or dependency is required.

## 1.14.5-beta.1 — Clear Player Controls
- Applied compact, collapsible explanations to market views, shop collections, decor and player settings. Market controls fit touch screens, partial own orders show the sold amount, and a pending trade hub's timer updates even without orders.
- Shop recovery no longer promises an unconfirmed purchase or Premium renewal. Crystal Premium buttons state their action and duration; preview and application remain separate. Exact paid-receipt holds and all payment rules are preserved.
- Decor separates free cell selection from the paid placement and shows requirements beside the action. Demolition previews use the canonical catalog when a UI entry is missing, avoiding a false zero refund; actual server refunds and comfort are unchanged.
- Profile editing preserves an intentionally empty description and unsaved drafts during background refresh. Save, cancel, validation and results live beside the form; saved feedback uses the server-normalized profile. Player changes isolate drafts.
- Notification controls show pending, disabled, declined and server-confirmation states locally. Permission timeouts and unmount cancellation ignore late Telegram callbacks. Feedback keeps its text on failure, prevents duplicate pending submits and clears only after a confirmed saved message.
- No migration, dependency, price, reward, production or saved-city change is required. Notification delivery, profile validation and feedback processing on the server retain their existing rules.

## 1.14.4-beta.1 — From Stock to a Clear Result
- Brought production, expeditions, supply projects and colony contracts into the shared compact mechanics-guide pattern. Main costs and actions remain visible; recipe settings, route details and probabilities can be expanded separately.
- Production distinguishes insufficient space for a whole finished cycle from a completely full warehouse, and offers a direct status refresh for building or upgrading foundries. Changing a recipe, mode, link or batch remains free.
- Supply projects initially choose a still-needed resource with available stock when possible and a shipment within that stock. Manual selection survives background refresh; finished stages and logistics downtime explain the correct next action without blocking earned claims.
- Expeditions explain occupied slots, incomplete cargo and route requirements beside the relevant action; secondary details no longer push every launch far below its summary. Launch prices, outcomes, research bonuses and discovery probabilities are unchanged.
- Contracts distinguish ready orders from shortages and never suggest rebuilding an existing trade hub. Completion feedback uses the matching server receipt rather than the displayed estimate; an incomplete or foreign receipt offers refresh instead of reporting success.
- No migration, dependency, price, reward, production rule or saved-city change is required.

## 1.14.3-beta.1 — Know Your Next Step
- Applied one compact, collapsible mechanics guide across research, quests, login rewards, achievements, season, colony events, mail and social activities. Costs, rewards, availability and the next action remain visible beside their controls; secondary explanations can be expanded when needed.
- Research planning separates the next step's cost from the whole chain budget and checks resources, laboratory, queue and feature availability before advertising a launch. Choosing a plan remains free.
- Quest and login refresh times now come from the same database day/week as their actual progress, displayed in the device's timezone. Clarified individual versus combined rewards, streak versus cycle day, achievement cosmetic names and their duration.
- Explained paid cooperative shifts, shared science after operation completion, league eligibility versus actual prizes, and each side's referral bonus. Event choices display their preparation state; compact controls fit touch screens.
- Mail now rejects incomplete pages without replacing valid letters, offers an explicit retry and ignores stale initial-load replies. Opening a letter still never marks it read or repeats its reward automatically.
- Existing prices, payouts, research gates, saved cities, production, purchases and database schema are unchanged. No migration or dependency is required.

## 1.14.2-beta.1 — One Colony, Consistent Rules
- Unified building labels across the catalog, art, guide, construction feedback and new notifications. Market subsections now have distinct buy, sell, orders and price icons; Telegram Stars has its own currency icon and label.
- Use one duration formatter across construction, production, research, contracts, expeditions, alliance waits and the season. Rounded waits cannot show an overflowing minute or hour field; action deadlines remain unchanged.
- The market now distinguishes a missing, building or upgrading trade hub and offers the correct build or refresh action. Contracts explain that player trading additionally needs its research.
- Clarified shop ownership, previews, timed rewards and disabled payment/recovery states. Premium renewal waits for its exact own paid receipt, including after reload; an already active subscription does not acknowledge a second purchase. Existing payment fulfillment, prices and economy are unchanged.
- No migration or dependency is required; saved cities, prepaid queues, resource balances and existing purchases are preserved.

## 1.14.1-beta.1 — Clear Rules and Lunar Finds
- Alliance creation now costs 100 earned crystals with a separate confirmation; joining remains free. The server publishes the currency and requires the confirmed price, so old tabs cannot unexpectedly spend crystals. Existing alliances are unchanged.
- Added four distinct lunar artifact illustrations across the collection, navigation and expedition rewards. The collection shows translated rarities, progress, real per-route discovery chances and a direct path to the permanent-frame achievement.
- Shared artifact drop weights now power server selection and player-facing probabilities with the same outcomes as before. Clarified event rewards, preserved cargo, repeat finds and the exact scope of the expedition science research bonus.
- Expanded the mechanics guide with supply projects, expeditions, collection rewards and alliance entry rules. Existing resources, production rates, timers, prepaid outcomes and saved cities are preserved; no migration or dependency is required.

## 1.14.0-beta.1 — Give Production a Destination
- Added three finite supply projects with three stages each: a lunar cargo route, polar laboratory and Dawn district. Deliver ore, energy and parts in explicit partial shipments for credits, science, bounded crystals and permanent titles. There is no expiry or loss for absence.
- Active logistics and HQ3 enable deliveries. Project selection is free and local; each project's progress stays separate. First delivery snapshots all future costs and rewards. Earned stage rewards can be collected during logistics downtime and cannot pay twice.
- Production now plans toward the selected stage, accounting for stock, every prepaid queue, researched recipe output and available workshop slots. Applying the suggested batch only changes cycle selection; starting and paying remain separate actions.
- Integrated projects under City → Supplies alongside existing contracts, gave logistics a purpose in the catalog/inspector, and added ready-reward navigation hints. Two additive tables preserve existing cities, inventories, paid queues, resource rates and purchases.

## 1.13.1-beta.1 — Find Your Lunar Crew
- Added a searchable, paged directory of open alliances with real funded mining activity over the last seven days, independent of historical AP. Public listings expose team aggregates rather than player identities or private cargo.
- Split joining into Find / By Code / Create views, with the actual rejoin deadline shown before submission. Search and paging do not change the player's game session or join a team automatically.
- Cooperative operations now show a compact contributor breakdown with accepted modules and support roles. Former members' paid contributions remain visible to their original team; personal pending cargo never exposes another team's roster.
- Kept production, rewards, league scoring, technology balance and saved cities unchanged. No migration or new dependency is required.

## 1.13.0-beta.1 — Work Together on the Moon
- Added shared six-hour mining operations with three support roles, up to three paid modules per participant, a bonus for different people and roles, and personal cargo that survives leaving, removal or deletion of its alliance. Cargo waits for full warehouse space and does not expire.
- Operations generate shared alliance science. Officers and owners can develop drilling and sample-analysis technologies; each operation snapshots its levels and research purchases use expected-level checks and replay receipts.
- Added a weekly cooperative league, separate from historical SP/AP: new paid participation earns points for the alliance chosen by the first contribution that week. Membership changes cannot move past points. Prize-eligible teams need three contributors with at least two modules each.
- Weekly standings freeze once. Personal prizes include bounded crystals, titles, badges and frames; alliance crystal pools are split 40% equally and 60% by qualified contribution, with exact finite totals. Earned claims survive leaving the team and cannot be paid twice.
- Integrated mining and technology subsections into Alliances and a paged league/reward view into Rankings. Existing megaprojects, daily goals and historical standings remain available. Added additive schema migrations and concurrency/expiry/storage/replay tests; existing cities, balances, purchases and production rules are preserved.
## 1.12.3-beta.1 — Plan Production on the Map
- Added an optional production overlay to the city map: active neighbouring mines and energy suppliers connect visually to foundries. Planning highlights useful free cells, suppliers and a ghost of the proposed workshop; roads remain decorative.
- Foundry construction and relocation now preview a cell before a separate confirmation. Exact single-cycle alternatives come from the real quote: one supplier link per order, no stacking or combined discount. Construction costs and missing resources sit beside confirmation; relocation remains free and preserves paid jobs.
- Active foundry inspectors show the same comparison and can configure a standard-alloy, normal-mode, single-cycle order with the chosen link in production. This never starts an order automatically and repeated choices remain explicit.
- Preserved all resource prices, rewards, adjacency rules, queues, research, saved layouts and payments. Other construction/decor flows are unchanged. No migration, new asset or dependency is required.

## 1.12.2-beta.1 — Understand Every Upgrade
- Added a compact current → next comparison to active building inspectors: actual researched and Premium production, total storage capacity, foundry output/time/queue, lab technology level, HQ territory and expedition slots. Buildings with only a rating effect say so explicitly.
- Explain temporary production/storage pauses during upgrades and preserve already-paid foundry queues and ongoing research. Maximum levels and work in progress do not advertise a new upgrade price.
- Use the same configured upgrade duration for the session snapshot and paid action, correcting HQ Premium time in the inspector without changing actual completion times.
- Preserved prices, income rules, research gates, existing saves and payments. No migration, asset or dependency change is required.

## 1.12.1-beta.1 — City Actions at a Glance
- Replaced the map's two generic actions with a compact illustrated dock for construction, foundries, research and events. Decor, contracts and the existing public-city share action remain under More.
- Added snapshot-based status hints and quiet attention markers for work worth checking, active events and affordable valid contracts. Expired jobs and research request verification rather than promising a new reward; storage hints respect market escrow.
- Collapsed the foundry recipe catalog into an always-visible current recipe with an on-demand selector. Added a clearer prepaid ingredients → output → completion summary beside the start action, preserving parameters, requirements, queue behaviour, errors and server validation.
- Preserved all costs, rewards, research gates, saved cities and payments. No migration, dependency or new gameplay API is required.

## 1.12.0-beta.1 — A Lunar Visual Identity
- Added 24 original rendered lunar icons: six resources, six main sections and twelve activities. One shared renderer keeps resource/crystal artwork consistent in prices, rewards, navigation and help; utility controls retain clear vector glyphs.
- Gave map, foundry, contracts, events and decor distinct symbols, enlarged primary navigation artwork and retained labels. Locked market/expedition entries show their recognisable icon with a small lock and research explanation.
- Added six quiet section backgrounds with lunar modules, technology schematics, cargo infrastructure, mission orbits, crystal displays and communication relays. Their static decorative layers stay inside the app and do not cover the local profile chooser or intercept controls.
- Moved the permanent guide entry from every header to one labelled card in Connections → Settings, preserving contextual resource help, first steps, keyboard focus and Telegram Back behaviour.
- Preserved all economy, research, unlocks, payments and saved cities. No migration or dependency change is required.

## 1.11.0-beta.1 — A Living Lunar City
- Gave the reactor, warehouse, trade port and logistics centre distinct silhouettes; the reactor no longer uses solar panels. All renderers share transparent, individually measured sprites.
- Replaced roads with modular service decks that automatically join neighbouring roads, communications nodes and building entrances, including after relocation. These connections are visual and do not change production.
- Added lightweight building and decor activity animations, a saved motion setting and support for reduced motion. Hidden or inactive Mini Apps stop city movement.
- Added optional short action sounds, saved volume and explicit audio activation. Background refreshes remain silent; successful action sounds follow server confirmation.
- Expanded full city styles to every building and decor object, including roads and entrances. Added compact object-by-object before/after previews and paged collections; existing purchases, prices and future object coverage are preserved.
- Preserved all saved object keys, balances, production, research and placements. No database migration or new dependency is required.

## 1.10.5-beta.1 — A Lunar Home
- Replaced terrestrial decor with nine lunar installations: sealed plant capsules, a dome garden, rest module, navigation beacon, service deck, pioneer monument, hydroponics, a closed water recirculator and communications node.
- Added a transparent isometric decor atlas matching existing building materials, lighting and perspective, with individually measured viewports; connected service decks retain live map adjacency.
- Replaced the residential habitat's exposed rooftop greenery with sealed glass growing capsules, preserving its building identity and all gameplay properties.
- Updated decor icons, research names, guidance and city ground to fit an airless lunar settlement. Existing types, prices, comfort, unlocks and saved placements remain compatible; no migration is required.
- Excluded local saves and generated database credentials from Docker build contexts.

## Development — Isolated Windows Sandbox
- Added three independent local test cities with a tab-specific chooser: the existing personal save, a new colony and a developed base for trying advanced mechanics. Fixtures are initialized once and never reset on switching; their API is unavailable in production.
- Added portable PostgreSQL 16 setup and local start, stop, status and full test commands; no system service or Railway connection is required.
- Added one-click Windows launchers, a local-only banner and browser play with persisted isolated saves; Telegram SDK, paid purchases and outgoing bot messages stay disabled on this sandbox.
- Pinned loopback database targets and replaced inherited production credentials, including mixed-case Windows environment variables. Generated credentials, data, tools and Next.js environment types remain outside Git.
- Added configuration/isolation tests and a full PostgreSQL test command using a separate `colony_test` database. Production authentication and game economy are unchanged.

## 1.10.4-beta.1 — A Clearer Landscaping Loop
- Replaced long decor cards with compact choices and on-demand details, preserving art, costs, requirements and placement previews.
- Added the next historical comfort achievement goal and distinguished current comfort from the saved record.
- Prevented entering decor placement on a full map and provided a route back to inspect the city.
- Added explicit demolition confirmation with the exact half-price refund and recalculated comfort after removal; errors stay beside the action.
- Showed comfort when visiting another colony. Existing comfort, unlocks, refunds and rewards are unchanged; no database migration is required.

## 1.10.3-beta.1 — A Smoother Reward Loop
- Added local results and errors for daily, weekly and season rewards, with direct links from unfinished quests to their activity.
- Added explicit atomic collection of ready rewards for one quest period or the active season; repeated and simultaneous claims cannot duplicate payouts.
- Showed the next season reward, missing points, ready rewards and compact reward pages instead of a long track.
- Split alliance work into project, goals and members, with local member search and five members per page.
- Preserved existing reward values, progress, project costs and time rules; no database migration is required from v1.10.

## 1.10.2-beta.1 — Rewards and Messages Within Reach
- Split achievements into ready, in-progress and claimed views with five cards per page; comfort and referral links open the relevant reward topic.
- Added a direct link from earned cosmetics to the owned collection and a ready-achievement badge.
- Added server-side inbox pages, unread filtering and exact whole-inbox counters, preserving timestamp precision and player ownership. Reading explicitly marks the current message or visible page; older open clients remain compatible.
- Added local alliance action results, contribution cost/points previews and clear shortage messages; leadership transfer, exclusion and leaving show inline confirmations.
- Preserved existing reward values, project rules, progress and balances; no database migration is required from v1.10.

## 1.10.1-beta.1 — Clear Next Steps
- Kept a compact next step visible on the city map after the tutorial, with direct laboratory, research and base-upgrade guidance.
- Split the mechanics reference into short topics, including comfort and invitations, with direct navigation to each feature.
- Grouped research goals by purpose and added market access, first expeditions, landscaping and storage goals.
- Corrected tutorial and help text to explain the research requirements introduced in v1.10.
- Preserved tutorial rewards, saved goals, resource costs and research timing; no additional migration is required from v1.10.

## 1.10.0-beta.1 — A Living Colony
- Added a visible referral reward path and a manual 500-credit/10-crystal bonus for each side of a qualified HQ3 invitation, with unique receipts and historical eligibility.
- Added comfort, nine decor objects, free relocation, diminishing duplicate contributions and permanent achievement progress; new landscaping is unlocked through research.
- Added market and expedition technologies with server enforcement and one-time legacy access preservation; existing orders and paid expeditions remain recoverable.
- Reworked the city ground and connected roads, corrected all sixteen building atlas crops, added bespoke decor and achievement art, and unified resource icons.
- Rendered referral monuments as distinct rewards, including in shop previews and public cities.
- Requires migration `014_v1_10_colony_identity.sql` (included in `npm run db:init`) before starting the new server.

## 1.9.3-beta.1 — A Focused Building Catalog
- Grouped construction into resource, workshop, development and appearance categories with compact building tiles.
- Moved descriptions, costs, timing, ownership and requirements into on-demand building details.
- Made future base-level unlocks discoverable and retained direct research-plan and base-upgrade links.
- Preserved category selection, tutorial shortcuts, placement and existing economy; no database migration is required.

## 1.9.2-beta.1 — City Actions Within Reach
- Opened building and decor actions in an accessible panel over the map, with local feedback and close/back controls.
- Added direct links from buildings to the selected foundry, research, contracts, expeditions and alliance.
- Added a construction entry beside the map, feedback for empty cells and upgrade durations.
- Preserved placement, paid work, production settings and economy; no database migration is required.

## 1.9.1-beta.1 — Beta Visual Feedback
- Reduced research goal thumbnails, removed negative margins and reserved a consistent visual area inside each button.
- Added comfortable spacing around goal art without reducing the touch target or changing research behavior.
- Preserved square building proportions in wide cosmetic previews instead of squeezing images against the frame.
- Checked narrow mobile layouts and larger goal labels; no migration or economy changes.

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
