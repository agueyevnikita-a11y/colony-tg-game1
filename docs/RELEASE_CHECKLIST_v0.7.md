# Release checklist — COLONY v0.7

## Database
- Apply migrations 002 → 007 in order on an existing DB.
- For a fresh DB, execute db/schema.sql.
- Confirm `game_states.science` exists.
- Confirm user_research, expeditions, artifacts, user_artifacts exist.

## Research tests
- Research Lab produces Science during reconcile.
- Only one research may be active.
- Prerequisites/HQ/Lab level are server validated.
- Costs cannot make balances negative.
- Completed research effect becomes active only after completion.

## Expedition tests
- Expedition Center required.
- Unlocked expedition rules enforced server-side.
- Slot limit counts active, ready and event expeditions until claimed.
- Reward/event/artifact are generated once at start.
- Hidden reward is not sent to client before resolution.
- An event choice cannot be claimed twice.
- Choice resource cost is checked server-side.
- Storage caps apply to expedition rewards.
- Two identical artifact sources in one expedition grant two copies, but only one unique-artifact progress.
- `artifact_4` unlocks only after four distinct artifact types, not four duplicate drops.

## F2P tests
- No research/expedition endpoint accepts Stars.
- Aurora: paid permanent path remains available.
- expedition_25 grants temporary Aurora.
- expedition_100 grants permanent Aurora.
- Daily/weekly expedition quests progress only on completed/claimed expeditions.

## Build
- npm install
- npm run typecheck
- npm run build
- smoke test Telegram initData on staging
