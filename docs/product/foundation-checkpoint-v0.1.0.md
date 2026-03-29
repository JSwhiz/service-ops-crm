# Foundation Checkpoint v0.1.0

## Назначение

Этот документ фиксирует первую стабильную инженерную версию проекта после завершения foundation-контура.

## Что входит в v0.1.0

### Репозиторий и процесс

- приватный monorepo
- `main / dev / feature/*`
- базовый CI pipeline
- documentation layer inside repo

### Инженерная основа

- pnpm workspace
- shared config packages
- shared types package
- env strategy
- local Docker infrastructure
- Makefile
- root-level orchestration

### Infrastructure

- PostgreSQL
- Redis
- MinIO
- docker-compose.dev.yml
- local startup flow

### Backend

- NestJS backend shell
- config layer
- health endpoint
- auth foundation
- Prisma foundation
- Prisma-backed users
- roles / permissions / visibility / approval reference tables
- files foundation
- audit foundation

### Frontend

- Next.js frontend shell
- App Router
- app shell
- placeholder routes
- auth provider
- login page
- protected `(app)` layout

### Auth

- login
- refresh foundation
- logout foundation
- `/auth/me`
- protected frontend shell

### Persistence

- Prisma schema
- migrations
- seed

## Что еще не входит в v0.1.0

- доменные модули объектов
- задачи как полноценный persistent domain
- табельный модуль
- складской модуль
- equipment domain
- expenses/accountability domain
- chats domain
- production deployment pipeline
- integration/e2e test layer
- advanced access hardening

## Что считать критерием стабильности этой версии

Версия считается стабильной, если:

- backend собирается и запускается;
- frontend собирается и запускается;
- `pnpm ci:check` проходит;
- Prisma generate / migrate / seed работают;
- auth flow работает;
- project can be used as safe starting point for domain development.
