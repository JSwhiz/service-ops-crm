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

### object-operations

Arrival photos, daily reports, object comments, operational object feed, daily attendance fact, object employee options for attendance.

### timesheets

Monthly timesheet container, employee rows, numeric day cells, row totals and month totals derived from operational facts.

## Important note

Attendance panel must use real object employee assignments instead of hardcoded employee stubs.
