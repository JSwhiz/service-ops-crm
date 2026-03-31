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

Monthly timesheet container, object-linked employee rows, numeric day cells, row totals and month totals.

## Important note

Timesheets foundation is now numeric-day-cell based.
Daily attendance source in object card will be added in the next microstage.
