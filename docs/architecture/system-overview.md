# System Overview

## Назначение системы

Service Ops CRM — внутренняя web-система для управления регулярными объектами, разовыми заказами, задачами, сотрудниками, расходниками, оборудованием, расходами, подотчетом, подтверждениями и внутренней коммуникацией.

Система создается как единая рабочая среда для операционной деятельности компании.

## Основные продуктовые контуры

- объекты
- ежедневная работа по объекту
- задачи
- разовые заказы
- табель и зарплатная логика
- склад расходников
- оборудование
- сотрудники / HR / подмены
- подотчет и расходы
- чаты
- подтверждения
- уведомления
- отчеты
- аудит

## Базовый стек

- Next.js + TypeScript
- NestJS + TypeScript
- PostgreSQL
- Redis
- MinIO
- Docker Compose
- Prisma

## Макроархитектура

### Frontend

Web-приложение на Next.js:

- рабочий стол;
- списки;
- карточки сущностей;
- формы;
- табличные экраны;
- чатовый UI;
- уведомления.

### Backend

Монолитный backend на NestJS с модульной структурой:

- auth
- users-access
- objects
- object-operations
- tasks
- one-time-orders
- timesheets
- inventory
- equipment
- employees-hr
- expenses-accountability
- chats
- approvals
- notifications
- reports
- files
- audit

### Database

PostgreSQL — основной источник истины.

### Realtime

Redis + WebSocket контуры для:

- чатов
- уведомлений
- очереди подтверждений

### File storage

MinIO как S3-compatible storage.

## Основные архитектурные принципы

- монолитный backend, а не микросервисы;
- PostgreSQL как source of truth;
- отдельный контур прав, видимости и подтверждений;
- отдельный файловый модуль;
- отдельный аудит;
- soft delete для большинства бизнес-сущностей;
- shared config и shared types через workspace packages;
- документация внутри репозитория.

## Текущий этап

Система находится на стадии foundation-разработки:

- git foundation
- monorepo foundation
- workspace foundation
- documentation foundation

Следующие этапы:

- env strategy
- docker dev infrastructure
- backend shell
- frontend shell
- auth foundation
- prisma foundation
- CI basics
