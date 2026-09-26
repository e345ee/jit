# Развертывание

## Цель

Поднять проверяемый контур: `web`, `api`, `bot`, `worker`, `postgres`, `redis`, публичный HTTPS для MAX mini app и webhook, без попадания секретов в репозиторий или Docker build context.

## Перед деплоем

1. Зафиксировать commit hash сдаваемой версии.
2. Проверить локально:

```bash
npm install
npm run build
npm test
npm run test:e2e
npm run check:secrets
npm run audit:project
```

3. Проверить зависимости:

```bash
npm run audit:deps
```

4. Создать локальные secret-файлы для Docker:

```bash
mkdir -p secrets
printf '%s\n' "$MAX_BOT_TOKEN" > secrets/max_bot_token
printf '%s\n' "$MAX_WEBHOOK_SECRET" > secrets/max_webhook_secret
printf '%s\n' "$RUSSIAN_TRUSTED_ROOT_CA_PEM" > secrets/russian_trusted_root_ca
chmod 600 secrets/max_bot_token secrets/max_webhook_secret secrets/russian_trusted_root_ca
```

## Локальный Docker smoke

```bash
COMPOSE_PROJECT_NAME=patient-navigator \
DOCKER_BUILDKIT=0 \
COMPOSE_DOCKER_CLI_BUILD=0 \
docker compose up --build
```

В другом терминале:

```bash
SMOKE_API_URL=http://127.0.0.1:3001 npm run smoke
```

## Production-like переменные

Обязательные:

- `MAX_BOT_TOKEN` или Docker secret `max_bot_token`.
- `MAX_WEBHOOK_SECRET` или Docker secret `max_webhook_secret`.
- `russian_trusted_root_ca` - CA-файл для доверия к сертификату `platform-api2.max.ru` внутри Node-контейнеров.
- `MINI_APP_PUBLIC_URL` - только HTTPS, без плейсхолдера.
- `MAX_MINI_APP_WEB_APP` - публичное имя или MAX-ссылка бота для нативной кнопки `open_app`, если MAX требует явную ссылку.
- `API_PUBLIC_URL` - HTTPS адрес API, если API открыт отдельно.
- `CORS_ORIGIN` - публичный origin mini app.
- `COMMIT_SHA` - hash сдаваемой версии.

Bot в `NODE_ENV=production` не стартует, если `MINI_APP_PUBLIC_URL` не HTTPS, содержит плейсхолдер, нет токена или webhook secret.

## HTTPS и MAX

Для проверки в MAX нужны:

- публичный HTTPS URL mini app;
- публичный HTTPS URL bot webhook;
- корректный `MAX_WEBHOOK_SECRET`;
- webhook update types: `message_created`, `bot_started`;
- кнопка mini app в сообщении бота.

## Проверка после деплоя

1. `GET /health` возвращает `status: ok`.
2. `GET /ready` возвращает `status: ready` и счетчики контента.
3. `GET /content/version` возвращает `commit`.
4. `DATA-API.yaml` проверки проходят.
5. Бот отвечает на `/start`.
6. Повторный webhook update не создает второй ответ.
7. Mini app ищет `МРТ`, `полис`, `больничный`, `ребенок`, `переезд`, `льготы`.

## CI/CD

GitHub Actions workflow `.github/workflows/ci-cd.yml` выполняет build, unit/e2e tests, audit-проверки, затем деплоит `main` на сервер по SSH.

Repository secrets:

- `DEPLOY_HOST` - IP сервера.
- `DEPLOY_USER` - пользователь деплоя.
- `DEPLOY_SSH_KEY` - приватный SSH-ключ деплоя.
- `DEPLOY_PATH` - путь проекта на сервере, например `/opt/jit`.
- `PUBLIC_WEB_URL` - публичный HTTPS URL mini app и webhook.

MAX bot token и webhook secret хранятся только на сервере в `secrets/`, а не в GitHub Secrets. После деплоя `scripts/deploy-server.sh` пересобирает контейнеры, запускает smoke-check и регистрирует MAX webhook на `${PUBLIC_WEB_URL}/webhook`.

## Что остается production-долгом

- Secret manager вместо локальных файлов.
- Централизованные логи и метрики.
- Backup PostgreSQL.
- Расширенный мониторинг доступности с внешним alerting.
