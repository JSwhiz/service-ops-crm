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
- env strategy foundation.

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

## Документация

См. каталог `docs/`:

- `docs/architecture/` — архитектурные документы
- `docs/product/` — продуктовые сводки по этапам
- `docs/decisions/` — ADR и ключевые решения
- `docs/onboarding/` — инструкции по запуску и работе с проектом

## Локальный запуск

Подробная инструкция будет поддерживаться в:

- `docs/onboarding/local-setup.md`

По мере развития foundation-этапов туда будут добавляться:

- env setup
- infra startup
- database migration flow
- frontend/backend start
- development workflow

## Текущее направление разработки

Текущий фокус:

- foundation слоя проекта;
- backend/frontend shell;
- auth foundation;
- database foundation;
- CI и инженерной дисциплины проекта.

## Важно

Этот репозиторий — основной источник истины по:

- структуре проекта;
- инженерным решениям;
- workspace организации;
- архитектурным документам;
- будущему production-контуру.
