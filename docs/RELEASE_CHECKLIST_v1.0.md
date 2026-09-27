# COLONY v1.0 Beta — Release Checklist

## Build
- [ ] `npm install`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] production `ALLOW_DEV_AUTH=false`

## Database
- [ ] backup database if upgrading an existing environment
- [ ] apply `010_v1_0_beta.sql` or run cumulative `npm run db:init`
- [ ] verify `system_settings`, `beta_invite_codes`, `beta_access`, `player_feedback`, `api_rate_limits`

## Telegram
- [ ] `npm run doctor`
- [ ] `npm run telegram:webhook`
- [ ] Main Mini App URL configured in `@BotFather`
- [ ] real Telegram initData session works
- [ ] notification write permission prompt tested

## Payments
- [ ] invoice opens in Telegram
- [ ] successful payment creates exactly one entitlement
- [ ] repeated webhook is idempotent
- [ ] “Проверить покупки” with no missing purchase does not grant anything
- [ ] `telegram_payment_charge_id` is stored
- [ ] refund update is logged/marked refunded

## Access control
- [ ] admin can enable maintenance
- [ ] ordinary player is server-blocked during maintenance
- [ ] admin can disable maintenance
- [ ] admin can create limited-use beta code
- [ ] enable `beta_required`
- [ ] fresh player cannot enter without a code
- [ ] valid code grants permanent beta access
- [ ] exhausted/invalid code is rejected

## Closed-test operations
- [ ] `/api/health` returns OK
- [ ] notification cron configured
- [ ] feedback form creates admin-visible entry
- [ ] feature flags can disable market/alliances/expeditions/Stars
- [ ] watch error telemetry during first 10 testers
