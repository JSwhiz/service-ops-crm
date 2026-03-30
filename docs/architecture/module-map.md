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

## Responsibility boundaries

### users-access

Users, roles, permissions, visibility groups, approval capabilities, selector sources for internal forms.

### tasks

Tasks, assignees, task result flow, object-linked task control.

## Important note

Permissions, visibility groups and approval capabilities are not optional metadata.
They are part of the extensible access architecture and must remain in seed/data strategy even before full admin UI is implemented.
