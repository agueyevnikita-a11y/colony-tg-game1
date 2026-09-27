# COLONY v1.0.1 — Railway quick start

This build copies `scripts/` and `db/` into the production Docker image so `db:init`, `doctor`, and `telegram:webhook` can be executed inside the deployed Railway service.

Recommended deployment order:
1. Create Telegram bot and save token.
2. Create Railway project, PostgreSQL service, and empty app service.
3. Set app variables, including `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `NEXT_PUBLIC_BOT_USERNAME`. The bot username is a Docker build argument and is embedded in browser code, so changing it requires a rebuild.
4. Deploy local folder with `railway up`.
5. Generate public Railway domain and set `APP_URL` to it. Redeploy.
6. Run remotely: `railway ssh -- npm run db:init`, `railway ssh -- npm run doctor`, `railway ssh -- npm run telegram:webhook`.
7. Configure Main Mini App in BotFather to `APP_URL`.
8. Open `https://t.me/<bot_username>?startapp`.
