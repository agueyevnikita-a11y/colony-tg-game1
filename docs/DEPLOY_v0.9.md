# COLONY v0.9 — Deployment

## Вариант A: Docker
1. Скопировать `.env.example` в `.env` и заполнить секреты.
2. Поднять PostgreSQL и применить `db/schema.sql`.
3. Собрать контейнер: `docker build -t colony:0.9 .`.
4. Запустить приложение на порту 3000 за HTTPS reverse proxy.
5. Проверить `GET /api/health`.

`docker-compose.example.yml` показывает минимальную схему app + PostgreSQL. Для реального сервера пароль базы и все Telegram secrets должны храниться вне репозитория.

## Вариант B: managed Next.js + managed PostgreSQL
Нужны те же переменные окружения. После подключения базы применяется `db/schema.sql`; приложение запускается стандартными `npm run build` / `npm start`.

## Обязательные фоновые вызовы
`POST /api/cron/notifications` должен регулярно вызываться планировщиком с заголовком `Authorization: Bearer <CRON_SECRET>`. Очередь использует блокировки PostgreSQL и безопасна при параллельных запусках.

## Feature flags
Флаги находятся в таблице `feature_flags`. Администратор также видит их в игровом Admin-блоке и может включать/выключать их. `rollout_percent` можно менять непосредственно в БД или через admin API.

## Health
`GET /api/health` проверяет доступность PostgreSQL и возвращает версию приложения. Ответ 503 означает, что приложение не готово принимать тестеров.
