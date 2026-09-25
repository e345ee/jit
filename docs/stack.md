# Стек

## Рекомендуемый стек

- Frontend mini app: React, TypeScript, Vite.
- UI: MAX UI, если доступна и подходит; иначе собственные компоненты с визуальной совместимостью под MAX.
- Bot: Node.js, TypeScript.
- Backend API: Node.js, TypeScript, Fastify.
- Database: PostgreSQL для напоминаний и служебных сущностей.
- Queue/cache: Redis + BullMQ для отложенных уведомлений.
- Content: JSON в репозитории с Zod-валидацией.
- Search: endpoint поиска по подготовленному индексу.
- Docker: multi-stage Dockerfile, compose.yaml.
- Tests: Vitest для unit-тестов, Playwright для основного сценария mini app.
- Observability: pino logs, healthchecks, basic metrics endpoint.

## Почему так

React и TypeScript соответствуют рекомендациям PDF и ожидаемой модели MAX mini app. Node.js позволяет держать bot, API, worker и контентную валидацию в одном языке, что снижает сложность для хакатона. Fastify дает легкий API без тяжелой инфраструктуры. PostgreSQL и Redis не обязательны для первого прототипа, но нужны для устойчивых напоминаний и понятной распределенной архитектуры.

## Режимы запуска

1. Local run
   - `web`, `api`, `bot`, `worker`, `postgres`, `redis`.
   - Все запускается через `compose.yaml`.

2. Demo in MAX
   - Mini app доступен по HTTPS.
   - Bot использует webhook или polling в зависимости от возможностей MAX и скорости настройки.

3. Future production
   - Web на CDN или статическом хостинге.
   - API и bot в контейнерах с несколькими репликами.
   - Worker отдельно.
   - PostgreSQL managed.
   - Redis managed.

## Контракты данных

Схемы контента должны быть типизированы и валидироваться при сборке:

- `SituationCard`
- `DecisionQuestion`
- `Step`
- `KnowledgeCard`
- `SourceRef`
- `Reminder`

Каждая карточка обязана иметь источник, дату актуальности, регион применимости и пометку о тестовых или модельных данных, если применимо.
