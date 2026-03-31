# Module Map

## Backend module map

### Core / foundation

- auth
- users-access
- files
- audit
- prisma

### Domain modules

- objects
- object-operations
- tasks
- timesheets
- one-time-orders
- inventory
- equipment
- employees-hr
- expenses-accountability
- chats
- approvals
- notifications
- reports

## Responsibility boundaries

### objects

Core object data, status, assignments, daily base rate.

### timesheets

Monthly timesheet container, object-linked employee rows, numeric day cells, row totals and month totals.

## Important note

At this stage, object daily rate is the base source for timesheet day values.
Manual day cell changes override the base and must not be auto-rewritten by rate sync.
