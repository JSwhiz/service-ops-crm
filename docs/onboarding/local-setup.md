# Local Setup

## Что уже должно быть готово

На текущем этапе уже должны быть готовы:

- auth foundation
- prisma foundation
- objects foundation
- object operations foundation
- tasks foundation
- task UX hardening
- timesheet numeric foundation
- object daily rate foundation
- daily attendance source from object card

## Что проверить после запуска

- `/objects`
- `/objects/[id]`
- `/timesheet`

## Особое внимание

Проверить, что:

- attendance в карточке объекта показывает локальную сегодняшнюю дату;
- список сотрудников в attendance-panel приходит с backend;
- в карточке нет хардкодных сотрудников;
- route `/api/v1/objects/:id/employees` работает;
- attendance сохраняется по реальному составу объекта.# Local Setup

## Что уже должно быть готово

На текущем этапе уже должны быть готовы:

- auth foundation
- prisma foundation
- objects foundation
- object operations foundation
- tasks foundation
- task UX hardening
- timesheet numeric foundation
- object daily rate foundation
- daily attendance source from object card

## Что проверить после запуска

- `/objects`
- `/objects/[id]`
- `/timesheet`

## Особое внимание

Проверить, что:

- attendance в карточке объекта показывает локальную сегодняшнюю дату;
- список сотрудников в attendance-panel приходит с backend;
- в карточке нет хардкодных сотрудников;
- route `/api/v1/objects/:id/employees` работает;
- attendance сохраняется по реальному составу объекта.
