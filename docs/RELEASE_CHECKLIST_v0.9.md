# COLONY v0.9 — Closed Beta Release Checklist

## До деплоя
- [ ] Создать отдельную PostgreSQL базу для beta.
- [ ] Выполнить `db/schema.sql` на новой базе либо `009_v0_9.sql` поверх v0.8.
- [ ] Заполнить `.env` без `ALLOW_DEV_AUTH=true`.
- [ ] Указать `BOT_TOKEN`, `BOT_USERNAME`, `NEXT_PUBLIC_BOT_USERNAME`, `APP_URL`.
- [ ] Сгенерировать случайные `TELEGRAM_WEBHOOK_SECRET` и `CRON_SECRET`.
- [ ] Указать Telegram ID администраторов в `ADMIN_TELEGRAM_IDS`.
- [ ] Выполнить `npm install`.
- [ ] Выполнить `npm run typecheck`.
- [ ] Выполнить `npm run build`.
- [ ] Проверить `GET /api/health`.

## Telegram
- [ ] Mini App URL указывает на HTTPS-домен релиза.
- [ ] Webhook указывает на `/api/telegram/webhook` с secret token.
- [ ] Cron вызывает `POST /api/cron/notifications` с `Authorization: Bearer <CRON_SECRET>` минимум раз в минуту.
- [ ] Stars invoice открывается внутри Telegram и successful_payment доходит до webhook.
- [ ] `requestWriteAccess` корректно включает уведомления.

## Smoke test
- [ ] Новый пользователь видит экран названия колонии.
- [ ] Имя сохраняется и видно при просмотре города с другого аккаунта.
- [ ] Daily streak создаёт только одну награду на дату.
- [ ] Повторное получение daily reward отклоняется.
- [ ] Inbox не дублирует welcome/tutorial/purchase сообщения.
- [ ] Feature flag `market=false` блокирует создание и покупку ордеров на сервере.
- [ ] Feature flag `alliances=false` блокирует create/join.
- [ ] Feature flag `expeditions=false` блокирует старт экспедиции.
- [ ] Feature flag `stars_shop=false` блокирует создание invoice.
- [ ] Admin dashboard показывает ошибки и feature flags.
- [ ] Клиентская тестовая ошибка появляется в `error_events`.

## Перед приглашением тестеров
- [ ] Сделать backup базы.
- [ ] Зафиксировать текущие значения экономики и feature flags.
- [ ] Включить `closed_beta_banner`.
- [ ] Не обещать сохранение beta-прогресса после публичного запуска.
