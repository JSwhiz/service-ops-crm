# Database Notes

## Source of truth

PostgreSQL is the primary source of truth for all business-critical data.

Redis is not a source of truth.

## Core principles

- UUID primary keys
- snake_case naming
- soft delete for most business entities
- audit as a separate system-wide trail
- files as universal records linked to business entities
- approvals as a universal table/engine
- visibility groups stored as data, not only code

## Important entity separations

### users vs employees

- users: system accounts, access, chats, approvals
- employees: HR/personnel directory, timesheets, assignments in labor context

### object comments vs chats

- object comments: structured object-specific operational feed
- chats: communication layer

### timesheets vs expenses

- timesheet is the source of truth for salary-related calculations in MVP
- manual and accountability-based expenses are stored separately

### approvals vs notifications

- approvals: decision queue
- notifications: user signals/events

## Soft delete policy

Soft delete is expected for:

- users
- employees
- objects
- assignments
- daily reports
- comments
- tasks
- one-time orders
- consumable records
- chats
- notifications

Soft delete is generally not recommended for:

- audit trail tables
- approval history
- read markers
- movement ledgers if they are treated as immutable facts

## MVP note about salary expenses

In MVP salary expense is derived from timesheets, not duplicated into expense_records as a primary mechanism.
