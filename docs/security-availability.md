# Безопасный и распределенный запуск

## Базовая позиция

Проект поднимается безопасно по умолчанию: секреты не попадают в git, внешние webhook-запросы проверяются, контейнеры ограничены по правам, а сервисы имеют healthcheck и restart policy. Доступность строится через разделение компонентов: `web`, `api`, `bot`, `worker`, `postgres`, `redis`.

## Что уже заложено

### Секреты

- Рабочий `MAX_BOT_TOKEN` хранится только в локальном `.env`.
- `.env` игнорируется git.
- Docker-запуск читает `MAX_BOT_TOKEN` и `MAX_WEBHOOK_SECRET` из локальных файлов `secrets/max_bot_token` и `secrets/max_webhook_secret`, а не через `env_file`.
- Папка `secrets/` игнорируется git.
- `.env.example` содержит только плейсхолдеры.
- `npm run check:secrets` проверяет, что реальный токен не попал в отслеживаемые файлы.

### MAX webhook

- Для production нужно использовать Webhook, а не Long Polling.
- Endpoint должен быть доступен по HTTPS.
- При подписке в MAX нужно передать `secret`.
- Bot проверяет заголовок `X-Max-Bot-Api-Secret` через переменную `MAX_WEBHOOK_SECRET`.
- Если секрет не совпал, webhook отклоняется с `401`.
- Повторные webhook-события дедуплицируются по message id или устойчивому ключу события.

### HTTP security

- API и bot используют security headers через Helmet.
- API и bot имеют rate limit.
- Логи редактируют чувствительные заголовки.
- Размер тела запроса ограничен.
- CORS по умолчанию ограничен локальными origin, а не открыт на все домены.
- Nginx для web выставляет CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

### Docker hardening

- Node-контейнеры запускаются не от root.
- Контейнеры получают `cap_drop: ALL`.
- Включен `no-new-privileges`.
- Для `api`, `bot`, `web` включен `read_only` filesystem с `tmpfs` только там, где нужен временный каталог.
- Для `worker` также включены `read_only`, `tmpfs`, `cap_drop: ALL` и `no-new-privileges`.
- Порты по умолчанию проброшены только на `127.0.0.1`.
- У сервисов есть healthcheck.
- У сервисов есть `restart: unless-stopped`.

## Локальный запуск

```bash
npm install
npm run build
npm run check:secrets
```

Docker:

```bash
COMPOSE_PROJECT_NAME=patient-navigator DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose up --build
```

Классический режим Docker нужен на этой машине из-за сбоя BuildKit/gRPC в пути с кириллицей.

Перед Docker-запуском локальные secret-файлы должны существовать:

```bash
mkdir -p secrets
printf '%s\n' "$MAX_BOT_TOKEN" > secrets/max_bot_token
printf '%s\n' "$MAX_WEBHOOK_SECRET" > secrets/max_webhook_secret
chmod 600 secrets/max_bot_token secrets/max_webhook_secret
```

## Распределенная схема

Компоненты масштабируются отдельно:

- `web` - статический frontend, можно держать несколько реплик или вынести на CDN.
- `api` - stateless content API, можно масштабировать горизонтально.
- `bot` - webhook-обработчик с idempotency/event deduplication.
- `worker` - отдельный сервис для due-напоминаний, читает PostgreSQL батчами и отправляет нейтральные сообщения через MAX Bot API.
- `postgres` - состояние напоминаний и служебных данных.
- `redis` - очередь и rate limiting.

## Production overlay

Для описания распределенного режима добавлен `compose.prod.yaml`:

```bash
COMPOSE_PROJECT_NAME=patient-navigator \
DOCKER_BUILDKIT=0 \
COMPOSE_DOCKER_CLI_BUILD=0 \
docker compose -f compose.yaml -f compose.prod.yaml up --build
```

В обычном Docker Compose поле `deploy.replicas` применяется ограниченно. Для реального production лучше использовать Docker Swarm, Kubernetes или managed containers. Для демо это файл с целевой топологией и параметрами тиражирования.

## Требования для публичного MAX

- Публичный HTTPS endpoint на порту 443.
- TLS-сертификат доверенного центра или сертификат Минцифры.
- Webhook должен отвечать `200 OK` быстрее 30 секунд.
- При подписке указать `update_types`: `message_created`, `bot_started`.
- При подписке указать `secret`, равный `MAX_WEBHOOK_SECRET`.
- Не передавать конфиденциальные данные в deeplink payload.

## Что еще нужно до production

- Включить централизованные логи и метрики.
- Добавить резервное копирование PostgreSQL.
- Настроить внешний reverse proxy или ingress с TLS.
- Настроить секреты через secret manager, а не `.env` на сервере.
- Провести threat modeling по медицинским и персональным данным перед загрузкой пользовательских документов.
