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

### users-access

Users, roles, permissions, visibility groups, approval capabilities, selector sources for internal forms.

### objects

Core object data, status, assignments, basic object card.

### object-operations

Arrival photos, daily reports, object comments, operational object feed.

### tasks

Tasks, assignees, task result flow, object-linked task control.

### timesheets

Monthly timesheet container, object attendance rows, daily attendance entries.

## Important note

Timesheets foundation at this stage covers attendance only.
Money cells, amount overrides, recalculation logic, budget signals and seasonal financial coupling are intentionally deferred to the next stage.
