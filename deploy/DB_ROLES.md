# Отдельная роль PostgreSQL для приложения

Основной `compose.yml` уже использует `colony_app` по умолчанию и содержит административный сервис `db-tools`. Файл `db-role.compose.yml` сохранён как совместимый override для ранее подготовленного запуска; его можно объединять с базовым без смены поведения. Runtime получает CONNECT, USAGE public, SELECT/INSERT/UPDATE/DELETE таблиц и USAGE sequences, без superuser, создания БД/ролей, bypass RLS и CREATE в public. По проверенному текущему коду `lib/` и `app/` DDL при обычных API-запросах не выполняется.

## Применение

Из каталога `deploy` на сервере, пока внешний доступ закрыт:

1. Сделать backup существующей базы и сохранить текущую конфигурацию. Добавить в защищённый `.env` **отдельный** `APP_DB_PASSWORD`: 64–256 случайных hex-символов. Сохранить `POSTGRES_PASSWORD`. Не выводить секреты в команды или журналы; файл должен иметь права `0600`.
2. Убедиться, что образ `colony-russia:local` уже собран и схема применена от владельца `colony`. У загруженного `provision-app-role.mjs` должны быть права `0644`, чтобы пользователь `node` внутри контейнера прочитал файл. В нём секретов нет.
3. Подготовить роль и проверить вход **до** пересоздания приложения:

```bash
docker compose -f compose.yml -f db-role.compose.yml config --quiet
docker compose -f compose.yml -f db-role.compose.yml --profile tools run --rm --no-deps db-tools
```

Команда предполагает уже работающий `db`. Если он ещё не запущен, сначала `docker compose -f compose.yml up -d --wait db`. Скрипт меняет только управляемую роль `colony_app` и grants. Неуправляемая существующая роль, членство в других ролях или CREATE через права PUBLIC останавливают транзакцию; чужие grants не отзываются автоматически. При повторном запуске пароль управляемой роли синхронизируется с `APP_DB_PASSWORD`, поэтому смену этого значения проводить только вместе с последующим пересозданием `app`.

```bash
docker compose -f compose.yml -f db-role.compose.yml up -d --wait app
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
curl --silent --show-error http://127.0.0.1:3000/api/ready
docker compose -f compose.yml -f db-role.compose.yml exec -T app npm run doctor -- --local
```

При работающем Caddy добавлять `-f https.compose.yml` к вызовам Compose, включая будущие обновления `app`. В актуальном базовом Compose отсутствие `db-role.compose.yml` уже не возвращает приложению административную роль. Нельзя трактовать успешный `/health/live` как проверку новой роли: нужны `/health` и `/ready` с `database=ok`, `schema=ok`.

## Миграции и backup

DDL выполнять только через административный сервис:

```bash
docker compose -f compose.yml -f db-role.compose.yml --profile tools run --rm --no-deps db-tools npm run db:init
```

Для Caddy аналогично добавить `-f https.compose.yml`. Default privileges применяются к будущим объектам, созданным именно `colony` в public. Если миграции будут создавать объекты под другой ролью/в другой схеме, grants нужно пересмотреть. Существующий `backup.sh` продолжает использовать административный сервис `db` и не зависит от runtime-пароля. Пароль `POSTGRES_PASSWORD` не передаётся в environment контейнера `app`: там остаётся только его собственная DATABASE_URL.

## Откат

Если проверка роли или приложения не прошла, не открывать внешний доступ. Исправить grants или доступ к БД и повторить provision до запуска runtime. Для отката использовать сохранённую конфигурацию предыдущего выпуска только после отдельной проверки её прав: актуальный базовый Compose остаётся на ограниченной роли. Не выполнять `DROP ROLE`, `DROP DATABASE` или `down -v` для этого отката.
