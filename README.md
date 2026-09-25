# Навигатор для пациента

MVP для трека "Забота о людях": мини-приложение в MAX с чат-ботом, которое помогает пациенту пройти понятный маршрут по медицинским и связанным государственным действиям: подготовка к обследованию, оформление документов, получение льгот или налогового вычета.

Основной сценарий: пользователь открывает бота в MAX, переходит в мини-приложение, находит жизненную ситуацию, отвечает на 1-2 уточняющих вопроса и получает карточку с шагами, сроками, частыми ошибками и локальным чек-листом.

## Быстрый запуск

```bash
npm install
npm run build
npm run dev
```

Проверки:

```bash
npm test
npm run test:e2e
npm run check:secrets
npm run audit:project
npm run audit:slop
npm run audit:deps
```

Локально:

- mini app: `http://localhost:5173`
- API: `http://localhost:3001`
- bot webhook/health: `http://localhost:3002`

Запуск через Docker:

```bash
docker compose up --build
```

Если Docker Desktop в локальной папке с кириллицей падает на BuildKit/gRPC, используйте классический режим сборки:

```bash
COMPOSE_PROJECT_NAME=patient-navigator DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose up --build
```

Распределенный production-эскиз:

```bash
COMPOSE_PROJECT_NAME=patient-navigator DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose -f compose.yaml -f compose.prod.yaml up --build
```

После Docker-запуска:

- mini app: `http://localhost:8080`
- API healthcheck: `http://localhost:3001/health`
- bot healthcheck: `http://localhost:3002/health`
- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`

Для проверки в MAX mini app должен быть доступен по HTTPS. На локальной разработке используйте tunnel или облачный хостинг и пропишите публичные адреса в `.env`: `MINI_APP_PUBLIC_URL` и `API_PUBLIC_URL`.

## Сценарий проверки MVP

1. Открыть mini app.
2. Найти ситуацию или документ: например "полис", "СНИЛС", "больничный", "вычет", "МСЭ" или "госпитализация".
3. Открыть карточку маршрута или справочный материал.
4. Для маршрута ответить на 1-2 уточняющих вопроса и проверить адаптированный список шагов.
5. Отметить один шаг в локальном чек-листе.
6. Открыть детали шага или справки и увидеть объяснение, где получить документ, срок и частые ошибки.
7. Создать нейтральное напоминание, если оно нужно. Оно не содержит диагноза.
8. Проверить источник, дату актуальности и статус данных.

## Состав решения

- `apps/web` - React + TypeScript + Vite mini app.
- `apps/api` - Content API для ситуаций, базы знаний и MVP-напоминаний.
- `apps/bot` - MAX bot webhook и адаптер `platform-api2.max.ru`.
- `apps/worker` - обработчик due-напоминаний из PostgreSQL.
- `packages/shared` - схемы и типы контента.
- `content` - карточки ситуаций и базы знаний: сейчас 60 ситуаций и 112 справочных материалов.
- `docs` - продуктовые, технические и коммерческие материалы.

## Документы

- [Архитектура](docs/architecture.md)
- [План действий](docs/plan.md)
- [Дальнейший план действий](docs/next-actions.md)
- [Функционал](docs/functionality.md)
- [Стек](docs/stack.md)
- [Дизайн-система MVP](docs/design-system.md)
- [MAX integration](docs/max-integration.md)
- [Demo script](docs/demo-script.md)
- [Стиль речи и маскот](docs/tone-and-mascot.md)
- [Анализ PDF требований](docs/pdf-analysis.md)
- [Проверка соответствия треку](docs/requirements-fit.md)
- [Подготовка продукта к продаже](docs/productization.md)
- [Анализ документов и контентный контур](docs/document-analysis.md)
- [Источники, эксперты и партнерства](docs/sources-and-help.md)
- [Безопасный и распределенный запуск](docs/security-availability.md)
- [One-pager для пилота](docs/commercial-one-pager.md)
- [План пилота](docs/pilot-plan.md)
- [Чек-лист соглашений](docs/agreements-checklist.md)
- [План презентации](docs/presentation-outline.md)
- [Развертывание](docs/deploy.md)
- [Нейрослоп-аудит](docs/neuroslop-audit.md)
- [Матрица требований](docs/requirements/README.md)

## Важное по безопасности

Рабочий токен MAX хранится только в локальном `.env`, который игнорируется git. В репозитории остается только `.env.example` с плейсхолдерами.

MVP не загружает пользовательские медицинские документы, не хранит диагнозы и не интерпретирует результаты анализов. Контентные карточки используют источники и дату актуальности; демонстрационные данные помечены как `synthetic`.

Webhook MAX должен настраиваться с секретом. Значение `MAX_WEBHOOK_SECRET` хранится только в локальном `.env`, а входящие webhook-запросы проверяются по заголовку `X-Max-Bot-Api-Secret`.

Для Docker bot читает секреты из локальных файлов `secrets/max_bot_token` и `secrets/max_webhook_secret`; папка `secrets/` игнорируется git.

Напоминания в production-контуре хранятся в PostgreSQL и обрабатываются отдельным `worker`. В локальном режиме без `DATABASE_URL` API автоматически использует in-memory storage, чтобы базовый сценарий работал без внешней базы.
