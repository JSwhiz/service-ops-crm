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

### auth

Authentication, session lifecycle, token flow.

### users-access

Users, roles, permissions, visibility groups, approval capabilities.

### prisma

Centralized database access and Prisma integration.

### files

Universal file upload, metadata and secure access.

### audit

System-wide audit trail.

### objects

Core object data, status, assignments, basic object card.

### object-operations

Arrival photos, daily reports, object comments, operational object feed.

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
- object core data != object operations
- object comments != chat messages
- approvals != notifications
- files != business entities
- timesheet entries != timesheet adjustments
- accountability operations != expense records

## Current implementation strategy

The system is developed in waves:

1. foundation
2. auth + persistence foundation
3. objects foundation
4. object operations foundation
5. next domain waves: tasks / one-time orders / timesheets
6. broader operational modules and cross-cutting polish
