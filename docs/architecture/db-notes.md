# Database Notes

## Current important layers

- users
- roles
- permissions
- visibility groups
- approval capabilities
- objects
- object operations
- tasks
- task assignees
- employees
- object employee assignments
- timesheet months
- timesheet employee rows
- timesheet day entries

## Important entity separations

### users vs employees

- users: system accounts, auth, access, approvals, tasks, comments
- employees: personnel/timesheet entity layer

### object assignment vs object employee assignment

- object assignment: system user on object (manager/responsible)
- object employee assignment: employee assigned to object for operational/timesheet purposes

### timesheet month model

Timesheet is modeled as:

- month container
- employee row snapshot
- numeric day entries

## Important clarification

Attendance reason codes are not the core model of the project timesheet.
The approved foundation is numeric day cells.
The daily source "who was on the object today" will be connected from object card in the next microstage.
