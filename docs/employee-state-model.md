# Employee state model

## Boundary

`Employee` is an operational HR record and is not a system `User`. The model has no
`userId` relation. Staffing, attendance and timesheet retain their existing separate
boundaries.

## Card lifecycle

- An active card has `deletedAt = null` and can be edited or used in new assignments.
- Archive is a soft transition that sets `deletedAt`; physical deletion is not exposed.
- An archived employee remains available in assignment history, attendance facts and
  historical timesheets, but is excluded from the default registry and new assignments.
- Archive is rejected while any `ObjectEmployeeAssignment.isActive = true`; assignments
  are never closed automatically by this transition.
- Restore clears `deletedAt` and makes the card operational again.

## Concurrency and audit

Employee edits, archive and restore require `expectedVersion`. A successful mutation
increments `version`; stale writes return `EMPLOYEE_VERSION_CONFLICT`. Create, update,
archive or restore and the corresponding audit event are committed in one transaction.

## Registry

The registry is server-paginated and defaults to active cards. Supported filters are
search by name/phone, active object, position, employment status, archive state, birth
month and active-assignment presence. Object filters use only active
`ObjectEmployeeAssignment` records; assignment history is not current staffing.

## Deferred scope

`birthDate` is stored for future product use. This stage does not create birthday
notifications, notification-center records, candidate links, employee-user links,
salary calculations or timesheet behavior.
