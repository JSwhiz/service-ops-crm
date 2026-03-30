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
- CI: GitHub Actions

## Статус проекта

Проект находится на стадии controlled product build after foundation.

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
- prisma foundation;
- ci basics;
- git workflow and stable checkpoints;
- objects foundation module;
- object operations foundation module.

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

Подробности:

- `docs/onboarding/git-workflow.md`

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

## Implemented product waves

### Foundation

- backend shell
- frontend shell
- auth foundation
- prisma foundation
- CI basics
- stable workflow and checkpoints

### Objects

- objects foundation module
- objects list page
- object create foundation page
- object detail foundation page

### Object operations

- arrival photo foundation
- daily report foundation
- object comments foundation
- object feed foundation

## CI basics

На текущем этапе уже реализован базовый GitHub Actions pipeline, который проверяет:

- install
- Prisma generate
- workspace typecheck
- backend build
- frontend build

Подробности:

- `docs/onboarding/ci-basics.md`

## Stable foundation checkpoint

Первая стабильная инженерная версия проекта:

- `v0.1.0`

Описание checkpoint:

- `docs/product/foundation-checkpoint-v0.1.0.md`

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

- tasks persistence;
- object card expansion;
- timesheet foundations;
- UI evolution с учетом desktop-first и обязательной адаптивности.

## Важно

Этот репозиторий — основной источник истины по:

- структуре проекта;
- инженерным решениям;
- workspace организации;
- архитектурным документам;
- будущему production-контуру.
