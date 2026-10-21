# Employee state model

## Boundary

`Employee` is an operational HR record and is not a system `User`. There is no
`Employee.userId`. Staffing assignments, attendance facts and timesheet calculations
remain separate entities. Candidates and reserve staffing are intentionally outside
this module.

## Types and work profile

- `employeeType` is `regular` or `one_time`; migrated records default to `regular`.
- `employmentStatus` describes whether the employee currently works and is independent
  from card archival.
- `workScheduleCode` supports canonical schedules and `custom`. A custom schedule
  requires `workScheduleCustom`; selecting a standard schedule clears custom text.
- `workTimeText` is human-entered display/filter text and is not parsed as a strict time.
- `baseDailyRate` belongs to the employee. `Object.dailyRate` belongs to an object and is
  displayed separately; neither value silently overwrites the other.

## Card lifecycle

- An operational card has `deletedAt = null` and can receive assignments when its
  capabilities allow it.
- Archive sets `deletedAt`, preserves all history and blocks new assignments. Archive is
  rejected while an active object assignment exists; assignments are never ended
  automatically.
- Restore clears `deletedAt` and returns the card to the operational registry.
- Permanent delete is only for an erroneously created card. The service checks every
  assignment, history, availability, substitution, attendance and timesheet dependency.
  Restrict foreign keys provide a second safety boundary. The deletion audit contains a
  snapshot and remains after the employee row is removed.

## Object assignments

Current staffing is represented by active `ObjectEmployeeAssignment` records and paired
history. Ending an assignment preserves history. Error deletion removes only the
assignment records and is rejected once attendance, timesheet or substitution history
uses the assignment. It never deletes the object.

## Attendance calendar and schedule

The employee card shows a read-only month calendar built from actual attendance facts
(`ObjectAttendanceFact`) via `GET /employees/:id/attendance?year=&month=`. It exposes the
date, object and worked hours only — no money, rate snapshots or planned shifts. Planned
working days are never derived from `workScheduleCode` or object rate policies in this
view. Availability windows and substitutions are entered from the same calendar and do
not create or remove attendance facts. See OQ-141.

## Concurrency and audit

Employee edits, archive, restore and permanent delete use `expectedVersion`. Successful
card mutations increment `version`; stale or concurrent writes return
`EMPLOYEE_VERSION_CONFLICT`. Business changes and audit events are committed in the same
transaction. Assignment mutation paths lock the relevant employee/object scope.

## Registry

The registry is server-paginated. Search, filters, sorting, items and total use one
database access scope. Object filtering uses only active assignments. The frontend keeps
filter state in the URL and ignores stale asynchronous responses.

## Deferred scope

Birthday notifications, candidate/reserve workflow, Employee/User linking and new salary
or timesheet behavior are separate product stages.

## Phones

- `Employee.phones` (text[]) holds every number; the first one is the main phone and is mirrored into `phone`, which search, exports and older consumers keep reading. The API accepts `phones` (preferred) or the legacy single `phone`; numbers are trimmed, de-duplicated by digits and must contain at least 3 digits.
- Migration `20261021120000_employee_phones` backfills `phones` from `phone`.
