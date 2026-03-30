# Database Notes

## Source of truth

PostgreSQL is the primary source of truth for all business-critical data.

Redis is not a source of truth.

## Prisma status

Current Prisma foundation includes:

- users
- roles
- permissions
- visibility groups
- approval capabilities
- objects
- object assignments
- object arrival photos
- object daily reports
- object comments
- tasks
- task assignees
- files
- audit events

## Important entity separations

### objects vs object operations

- objects: core object card, status, assignments, foundation fields
- object operations: arrival photos, daily reports, comments, daily flow

### tasks vs object comments

- task: управленческое поручение с lifecycle
- comment: оперативная запись по объекту

### task assignees

- отдельная таблица, потому что задача поддерживает multi-assignee foundation

### season mode

- на текущем этапе informational field only
- later должен быть связан с бюджетным/ставочным/табельным контуром
