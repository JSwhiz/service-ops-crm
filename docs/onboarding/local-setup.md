# Local Setup

## Статус документа

Документ находится в процессе наполнения.

## Назначение

Этот документ служит единой инструкцией локального запуска проекта.

## Что уже должно быть готово

На текущем этапе уже должны быть готовы:

- git repository foundation
- monorepo structure
- pnpm workspace foundation
- documentation foundation
- environment strategy foundation
- dev infrastructure foundation
- backend shell foundation
- frontend shell foundation
- auth foundation
- prisma foundation

## Шаг 1. Установить системные зависимости

На локальной машине должны быть доступны:

- Git
- Node.js LTS
- pnpm
- Docker
- Docker Compose plugin

## Шаг 2. Подготовить локальные env-файлы

Нужны:

- `.env.backend.local`
- `.env.frontend.local`

## Шаг 3. Поднять локальную инфраструктуру

```bash
make infra-up
```
