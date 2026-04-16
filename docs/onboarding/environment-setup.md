# Environment Setup

## Назначение

Этот документ описывает стратегию работы с environment variables в проекте Service Ops CRM.

Цель стратегии:

- не смешивать frontend, backend и infra-конфигурацию;
- не коммитить реальные секреты;
- обеспечить воспроизводимый local setup;
- заложить основу для staging и production.

## Основные правила

### 1. Не коммитить реальные secrets

В репозиторий попадают только:

- `.env.example`
- `.env.backend.example`
- `.env.frontend.example`
- `.env.infra.example`

Реальные runtime-файлы не коммитятся.

### 2. Разделять конфигурацию по зонам ответственности

- backend env — только для backend runtime
- frontend env — только для public browser-safe values
- infra env — только для Docker/local infrastructure

### 3. Не класть секреты в frontend env

Все значения с префиксом `NEXT_PUBLIC_` считаются публичными.

Туда нельзя класть:

- JWT secrets
- database credentials
- redis credentials
- storage secret keys

### 4. Не дублировать одну и ту же переменную разными именами

Имена env-переменных должны быть стабильными и единообразными.

## Рекомендуемая локальная схема

На локальной машине later можно использовать такие реальные файлы:

- `.env.backend.local`
- `.env.frontend.local`
- `.env.infra.local`

Или, если workflow будет проще:

- один `.env.local` на этапе раннего foundation,
  но при этом ответственность переменных все равно должна оставаться разделенной логически.

## Что использовать как источник правды

### Документация env

- `.env.example`
- `.env.backend.example`
- `.env.frontend.example`
- `.env.infra.example`

### Реальные значения

- локальные некоммитимые env-файлы
- server-side env на staging/production
- CI secrets later

## Практический local bootstrap

Рабочий локальный сценарий теперь такой:

1. `pnpm bootstrap:local`
2. `pnpm --filter backend start:dev`
3. `pnpm --filter frontend dev`

Bootstrap script:

- создает недостающие `.env.*.local` из example-файлов;
- поднимает PostgreSQL, Redis и MinIO;
- применяет миграции и seed;
- создает first admin bootstrap user.

## Принцип будущих окружений

Стратегия проектируется сразу под:

- local
- staging
- production

Даже если staging и production еще не подняты, naming и разделение ответственности должны быть одинаково корректными с самого начала.
