# CI Basics

## Назначение

Этот документ описывает базовый CI pipeline проекта.

## Текущий scope CI

На текущем этапе CI проверяет:

1. checkout репозитория
2. setup Node.js
3. setup pnpm
4. install зависимостей
5. генерацию Prisma Client
6. workspace lint
7. workspace typecheck
8. backend build
9. frontend build

## Что CI пока не делает

На текущем этапе CI пока не поднимает:

- PostgreSQL
- Redis
- MinIO
- docker-compose services

CI также пока не запускает:

- integration tests
- e2e tests
- миграции против реальной CI database

## Почему это нормально

Это intentional first-line pipeline.

Его задача:

- ловить compile/type/config regressions;
- проверять monorepo integrity;
- проверять Prisma generation;
- защищать main/dev от очевидно сломанных изменений.

## Локальный аналог CI

Для локальной быстрой проверки можно запускать:

```bash
pnpm ci:check
```

## Следующее развитие CI

Позже pipeline может быть расширен:
• lint
• test
• integration test
• ephemeral database migrations
• preview/staging deployment checks

## Backend integration harness

В репозитории добавлен baseline backend integration harness.

Локальный запуск:

```bash
pnpm test:backend:integration
```

Важно:

- integration harness ожидает, что local infra уже поднята;
- shared CI по-прежнему не поднимает PostgreSQL / Redis / MinIO автоматически.
