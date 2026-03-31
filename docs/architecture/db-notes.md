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

The timesheet is modeled as:

- month container
- employee row snapshot
- day entries

This is intentional to support later:

- money layer
- manual overrides
- month locking
- historical stability

## Important clarification

Current timesheet stage is attendance-first.
Financial amounts are intentionally not implemented in this stage.
