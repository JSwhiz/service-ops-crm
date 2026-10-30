# Scheduling API (2026-10-28)

SCHEMA STABLE: schema.prisma and the single additive migration 20261028120000_object_scheduling
are ready for ORCH client generation (host/container). No main database migration was run here.

Base: `/api/v1/objects/:objectId/scheduling`, authenticated CRM session.
Typed DTOs: `scheduling.dto.ts`; response interfaces: `scheduling.types.ts`.
Dates are strict YYYY-MM-DD in Europe/Moscow; times HH:mm, weekdays ISO 1=Monday…7=Sunday.

## Positions and immutable schedule revisions

- `GET /positions` → `{ positions: PositionView[], capabilities: {managePositions, manageRates, selectPayConditions, manageAssignments, confirmAttendance} }`.
- `GET /positions/:positionId` → `PositionView` (all revisions, ordered by effectiveFrom).
- `POST /positions` body `CreatePositionDto` → `PositionView` (201).
- `PUT /positions/:positionId` body `SavePositionDto` → `PositionView` (200).
- `DELETE /positions/:positionId` body `{expectedVersion,effectiveFrom,reason}` → `PositionView`; creates an archived revision, preserves history.

`CreatePositionDto = {clientKey:string, name:string, headcount?:number|null, requiredPerShift?:number,
 effectiveFrom:string, template:TemplateDto, groups:RotationGroupDto[]}`.
`SavePositionDto` adds `expectedVersion:number`; no clientKey.
`TemplateDto = {kind:'weekly'|'cycle'|'custom', anchorDate?:string|null,
 weekdays?:number[], sequence?:boolean[], exceptions?:{date:string,working:boolean}[]}`.
Cycle/custom use explicit sequence (2/2 = [true,true,false,false], 3/3 = three true/three false,
1/3 = [true,false,false,false]); weekly 5/2 uses weekdays [1,2,3,4,5].
Missing cycle anchor saves a template and previews a warning without invented shifts.
`RotationGroupDto = {key:string,name:string,offsetDays:number,timeRanges:TimeRangeDto[],
 assignments:{employeeId:string,from:string,to?:string|null}[]}`.
`TimeRangeDto = {key:string,start:string,end:string,endDayOffset:0|1,contourId?:string|null}`.
Null contour uses existing employee/object pay policy. Explicit contour bindings require
selectPayConditions: assigned managers may select any active ready contour of their own object;
rate managers also have selection rights. Creating/editing contour amounts still requires manageRates.
`PositionView = {id,objectId,clientKey,version,revisions:ScheduleRevisionView[]}`.
Revision: `{id,version,effectiveFrom,name,headcount,requiredPerShift,archived,template,groups,createdByUserId,createdAt}`.
headcount is total planned staffing, nullable (0..10000); requiredPerShift is simultaneous demand
per time range (default 1, 1..10000). Two rotating groups A1+B1 with headcount=2 and demand=1 are covered.
New revisions start today or later; several immutable revisions can share effectiveFrom.
Calendar selects effectiveFrom descending, then version descending. Today can be edited immediately;
future revisions remain and apply on their dates; confirmed facts retain their original revision.
Retry POST with the same clientKey and same payload returns the existing position; different payload → 409.

## Preview and employees

- `POST /api/v1/object-scheduling/preview` body `PreviewDto` with required single `draft`:
  server preview BEFORE object creation. Leadership/canCreateObject only; no writes, no amounts or
  pay snapshots. Active Employee references checked against directory rights. Contour references
  may be null or `draft:<code>` (syntax validated); persisted foreign contour IDs are rejected.

- `POST /preview` body `{from,to,positionIds?:string[],draft?:CreatePositionDto}` →
  `{from,to,shifts:ExpectedShift[],coverage:CoverageDay[],warnings:SchedulingWarning[],recommendedGroups:number|null}`.
- `GET /employees?date=YYYY-MM-DD&q=...` → `{employees:{id,fullName,available,warnings:string[]}[]}`.

Preview max 93 inclusive days, max 20,000 shift rows; no attendance/timesheet writes.
`ExpectedShift = {positionId,revisionId,groupKey,timeRangeKey,employeeId,operationDate,
 startsAt,endsAt,contourId}`; timestamps include Moscow offset.
`CoverageDay = {positionId,date,required:number,assigned:number,uncovered:number,intervals:{startsAt,endsAt,required,assigned,uncovered}[]}`.
Coverage is evaluated on temporal boundaries for each distinct scheduled time range, including empty
working groups. Day/night intervals are not added as simultaneous staffing. assigned is the minimum
concurrent distinct employee count; headcount is compared only with total distinct assigned staff.
Warnings `{code,message,date?,employeeId?,positionId?}` cover missing anchor/headcount,
unfilled groups, uncovered/over coverage, overlapping intervals, unavailable/out-of-scope employees.
Assignments reference existing Employees scoped by object staffing or active object substitution;
they do not silently create HR object assignments.

## Explicit pay contours (separate rate ACL)

- `GET /contours` → `{contours:PayContourView[]}`.
- `POST /contours` body `{code,name,dailyRate,summerDailyRate?:number|null,winterDailyRate?:number|null}` → `PayContourView`.
- `PATCH /contours/:contourId` body `{expectedVersion,name?,dailyRate?,summerDailyRate?:number|null,winterDailyRate?:number|null,isActive?}` → `PayContourView`.
`PayContourView = {id,objectId,code,name,dailyRate,summerDailyRate,winterDailyRate,isActive,version,effectiveFrom,updatedAt}`.
Rates are integer 0..100000000; null seasonal rates inherit base. Season is resolved on operationDate
using the object's automatic annual boundaries or explicit seasonMode. Prior dates without a
rate snapshot/current effective rate return 409 `HISTORICAL_RATE_UNAVAILABLE`.
Code is immutable and unique in object. Contours price daily exits only; monthly or other
incompatible employee policies + explicit contours → 409 `INCOMPATIBLE_PAY_MODES`.
Rate edits apply from today; confirmed snapshots never change. Contours cannot be physically deleted.

## Shift attendance

- `GET /attendance?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{attendance:ShiftAttendanceView[]}` (max 93 days).
- `POST /attendance/confirm` body `{requestKey:string,positionId,revisionId,groupKey,timeRangeKey,
 employeeId,operationDate}` → `ShiftAttendanceView`.
- `POST /attendance/:attendanceId/cancel` body `{expectedVersion:number,reason:string}` → `ShiftAttendanceView`.
`ShiftAttendanceView = {id,objectId,employeeId,operationDate,positionId,revisionId,groupKey,
 timeRangeKey,contourId,status:'confirmed'|'cancelled',version,startsAt,endsAt,
 dailyRateSnapshot,ratePolicySnapshot,createdByUserId,createdAt,cancelledByUserId,cancelledAt,cancelReason}`.
Confirmation validates the saved expected shift. Duplicate event or request retry returns the saved
fact; reused requestKey for another event → 409. Paid key is object+employee+operationDate+contour,
independent of position/group/range/requestKey. Same contour pays once; explicitly different
daily contours sum. Monthly/default policy is calculated once with the existing formula.
Confirmed snapshots survive schedule/rate edits. Cancellation preserves actor/reason and recomputes
the daily aggregate atomically with the timesheet; manual finalValue/comment are preserved.
Future attendance, closed months, incompatible modes and legacy daily facts → clear conflicts;
legacy attendance submission cannot replace a day owned by shift attendance.
After cancellation, replay of an already used confirmation requestKey returns the cancelled record.
A fresh requestKey explicitly reconfirms the same event, increments its version and preserves its
original rate/revision snapshot and cancellation metadata. Every transition and additional requestKey
is recorded in object audit. Historical reconfirmation requires manual correction rights.

## ACL, integration and failures

Position planning: own object operational scope (leadership, deputy_director, assigned responsible/manager).
capabilities also returns manageAssignments. Explicitly selected existing active Employees may be
atomically assigned to the object (with history/audit) when actor has employees.assignments.manage;
otherwise all group assignments must already be object-scoped staff/substitutes. Employee directory
requires both employees.view and employees.assignments.manage; other actors receive scoped options.
Core object editing is not granted. Contour creation/editing: existing canEditObjectDailyRate roles only.
Selecting existing active object contours is a separate selectPayConditions capability for assigned managers.
Historical cancellation requires existing manual timesheet correction rights; current-day cancellation
uses attendance scope. Archived/frozen/deleted object writes are rejected.
400 validation; 403 ACL; 404 missing scoped entity; 409 `{code,message}` conflict/version/history.

Standalone `ObjectSchedulingModule` imports PrismaModule/TimesheetsModule; ORCH registers it.
Atomic create hook: `ObjectSchedulingService.createPositionsInTransaction(tx,user,objectId,positions)`.
Atomic contour hook: `createContoursInTransaction(tx,user,objectId,contours:CreateContourDto[])` returns
created PayContour records with id/code. ORCH may map nested-create `draft:<code>` references to these
IDs before invoking the positions hook; regular endpoints accept only persisted object contour IDs.
The hook validates and writes using the supplied transaction, does not start a nested transaction,
and returns PositionView[]. It must be called after object creation inside the same transaction.
