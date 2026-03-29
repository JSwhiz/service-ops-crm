# Service Ops CRM

Внутренняя web-система управления объектами, задачами, сотрудниками, расходниками, подотчетом, чатами и внутренними процессами компании.

## Назначение проекта

Система проектируется как единая рабочая среда для ежедневного управления:

- регулярными объектами;
- разовыми заказами;
- задачами и подтверждениями;
- табелем и зарплатной логикой;
- расходниками и складом;
- оборудованием;
- подотчетом и расходами;
- внутренней коммуникацией;
- аудитом и уведомлениями.

## Технологический стек

- Frontend: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- Realtime/helper layer: Redis
- File storage: MinIO (S3-compatible)
- Infrastructure: Docker Compose
- ORM / migrations: Prisma
- Workspace: pnpm workspace

## Статус проекта

Проект находится на стадии foundation-разработки.

На текущий момент уже зафиксированы:

- архитектурная модель системы;
- модульная структура;
- модель ролей и видимости;
- схема monorepo;
- package management foundation;
- стратегия Git и версионирования;
- env strategy foundation;
- dev infrastructure foundation;
- backend shell foundation;
- frontend shell foundation;
- auth foundation;
- prisma foundation.

## Структура репозитория

- `apps/frontend` — frontend приложение
- `apps/backend` — backend приложение
- `packages/eslint-config` — общий ESLint config
- `packages/tsconfig` — общие TS presets
- `packages/shared-types` — общие типы и контрактный слой
- `infra` — docker, nginx, scripts, backups
- `docs` — архитектурная, продуктовая и onboarding-документация

## Основные принципы репозитория

- один приватный monorepo;
- frontend и backend живут отдельно;
- shared config и shared types живут в `packages/`;
- infrastructure code живет в `infra/`;
- документация живет в репозитории и версионируется вместе с кодом;
- root package управляет workspace, но не содержит application runtime code.

## Git strategy

- `main` — стабильная ветка
- `dev` — рабочая интеграционная ветка
- `feature/*` — ветки отдельных задач
- после устойчивых этапов ставятся теги

## Environment strategy

В проекте используется разделенная конфигурация по зонам ответственности:

- backend env
- frontend public env
- infrastructure env

Документация:

- `docs/onboarding/environment-setup.md`

Example-файлы:

- `.env.example`
- `.env.backend.example`
- `.env.frontend.example`
- `.env.infra.example`

Локальные runtime-файлы:

- `.env.backend.local`
- `.env.frontend.local`

## Local development infrastructure

Локальная инфраструктура поднимается через Docker Compose и включает:

- PostgreSQL
- Redis
- MinIO

На раннем этапе:

- infrastructure запускается в Docker;
- backend и frontend запускаются локально в dev mode.

Основные команды:

- `make infra-up`
- `make infra-down`
- `make infra-logs`
- `make infra-ps`

## Backend shell

Backend foundation реализуется в:

- `apps/backend`

На текущем этапе backend уже:

- запускается локально;
- читает env;
- валидирует env;
- имеет health endpoint;
- использует модульную структуру NestJS foundation.

## Frontend shell

Frontend foundation реализуется в:

- `apps/frontend`

На текущем этапе frontend уже:

- запускается локально;
- использует App Router;
- имеет app shell;
- имеет базовые foundation routes;
- готов к later подключению auth, dashboard и модулей системы.

## Auth foundation

На текущем этапе уже реализован foundation auth flow:

- login
- refresh
- logout foundation
- `/auth/me`
- protected app layout
- frontend auth provider
- login page

## Prisma foundation

На текущем этапе уже реализован foundation persistence layer:

- Prisma setup
- schema.prisma
- migrations flow
- Prisma Client
- Prisma-backed users
- roles / permissions / visibility / approval reference tables
- files foundation
- audit foundation

## Документация

См. каталог `docs/`:

- `docs/architecture/` — архитектурные документы
- `docs/product/` — продуктовые сводки по этапам
- `docs/decisions/` — ADR и ключевые решения
- `docs/onboarding/` — инструкции по запуску и работе с проектом

## Локальный запуск

Подробная инструкция поддерживается в:

- `docs/onboarding/local-setup.md`

## Текущее направление разработки

Текущий фокус:

- CI и инженерная дисциплина проекта;
- переход от foundation persistence layer к доменным модулям;
- users/access hardening;
- object and task persistence.

## Важно

Этот репозиторий — основной источник истины по:

- структуре проекта;
- инженерным решениям;
- workspace организации;
- архитектурным документам;
- будущему production-контуру.
