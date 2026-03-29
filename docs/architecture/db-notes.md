# Database Notes

## Source of truth

PostgreSQL is the primary source of truth for all business-critical data.

Redis is not a source of truth.

## Prisma status

Prisma is used as:

- ORM
- migration tool
- Prisma Client generator

Current Prisma foundation includes:

- users
- roles
- permissions
- visibility groups
- approval capabilities
- files
- audit events

## Core principles

- UUID primary keys
- snake_case naming in database
- soft delete for most business entities
- audit as a separate system-wide trail
- files as universal records linked to business entities later
- approvals and visibility stored as data
- system users and HR employees remain separate models

## Important entity separations

### users vs employees

- users: system accounts, auth, access, chats, approvals
- employees: HR/personnel directory, labor context, timesheets later

### object comments vs chats

- object comments: structured object-specific operational feed
- chats: communication layer

### timesheets vs expenses

- timesheet is the source of truth for salary-related calculations in MVP
- manual and accountability-based expenses are stored separately

### approvals vs notifications

- approvals: decision queue
- notifications: user signals/events

## Foundation note

At the current stage auth is already Prisma-backed, but the broader domain schema is still introduced gradually module by module.
