# Module Map

## Backend module map

### Core / foundation

- auth
- users-access
- files
- audit

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

### auth

Authentication, session lifecycle, token flow.

### users-access

Users, roles, permissions, visibility groups, approval capabilities.

### files

Universal file upload, metadata and secure access.

### audit

System-wide audit trail.

### objects

Core object data, assignments, budgets, contract info.

### object-operations

Arrival photo, daily report, object comments.

### tasks

Tasks, assignees, task result flow.

### one-time-orders

One-time orders, participants, files, status flow.

### timesheets

Attendance, amount calculation, adjustments, summaries.

### inventory

Consumables, stock movements, returns, object daily consumables.

### equipment

Equipment positions, movements, storage/object location.

### employees-hr

Employees, statuses, vacancies, substitutions.

### expenses-accountability

Accountability operations, expense records, links between them.

### chats

Chats, members, messages, attachments, reads.

### approvals

Universal approval engine and queue.

### notifications

User-facing notifications and delivery.

### reports

Read-only aggregation and exports.

## Important boundaries that must not be mixed

- users != employees
- object comments != chat messages
- approvals != notifications
- files != business entities
- timesheet entries != timesheet adjustments
- accountability operations != expense records
- objects != object-operations

## Current implementation strategy

The system will be developed in waves:

1. foundation
2. objects + daily object workflow
3. tasks + approvals
4. timesheets / one-time orders / inventory / equipment / expenses
5. chats / notifications / reports / polish
