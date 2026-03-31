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

## Что проверить после запуска

- `/objects`
- `/objects/[id]`
- `/tasks`
- `/timesheet`

## Особое внимание

На `/timesheet`:

- стрелки в number inputs отсутствуют
- sticky ФИО и sticky итог не ломаются при скролле
- в объекте есть ставка за день
- табель использует ставку объекта как базовое значение
