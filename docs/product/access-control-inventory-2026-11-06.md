# Authorization inventory — 2026-11-06

Status: source inventory and implementation handoff, not a certificate of completed rollout. Author: agent A. Inventory snapshot: pre-rollout baseline read during concurrent implementation; A did not change runtime during that inventory stage. Findings about missing checks describe the inspected baseline, not a claim that another agent's later patch still has that defect. The user subsequently authorized nine secondary backend modules; that separate code phase is recorded in the adapter status section below. No tests, database queries, production access, network requests, commits, seed or grants were executed by A. Typecheck/lint are reported separately from security tests. References below are repository-relative; symbols are the stable anchors when concurrent edits move line numbers.

## Contract and coverage boundary

Read in full: `AGENTS.md`; `docs/product/product-contract.md`; `docs/architecture/access-matrix.md`; `docs/architecture/glossary.md`; `docs/product/open-questions-register.md`; `docs/product/reconciliation-notes.md`; `docs/product/golden-path-index.md`; approved `docs/product/access-control-rollout-2026-11-06.md`. The approved rollout is authoritative for the current scope: ALL existing user capabilities, including role/creator/assignment branches, not only 51 catalog entries or the first five modules.

This inventory enumerates module operations, existing enforcement anchors, cross-channel consumers, baseline sources, proposed operation codes/scopes, business invariants and verification gaps. Controller routes are independently enumerated in the appendix. This is not a full codebase graph. A cataloged operation is **not connected** until its mutation/read, list scope, response fields, UI, secondary channels and negative tests actually consume the policy. Existing tests are listed as evidence locations only; none was run by A. A route/regex sweep cannot prove that every authorization branch has been correctly classified; unresolved branches remain explicit below.

Implementation ownership agreed in the active task: B owns catalog/resolver/schema/override preview-save; D owns objects/orders/inventory/counterparties/accountability; main owns search/files/notifications/realtime/sidebar; A may subsequently implement secondary backend adapters in tasks/employees/candidates/equipment/mats/timesheets/absences/visit/substitution after this inventory. This document alone does not mark those adapters implemented.

## Early findings and API recommendations

1. `users-access/utils/effective-permissions.util.ts::resolveEffectivePermissionCodes` unions UserPermission and RolePermission, sorts strings, and loses source. It cannot express deny, scope, precedence, expiry, resource eligibility or reason. `users-access/users.service.ts::authUserSelect/sanitizeUser` loads those grants; `auth/strategies/jwt.strategy.ts::validate` reloads the user from DB on authenticated requests. HTTP already has a fresh-user foundation; do not replace it with JWT-only authorization.
2. `inventory/utils/inventory-access.util.ts`: `manager`, `senior_manager`, `operation_manager` can read the global catalog; movement helpers permit leadership and `deputy_director`. Therefore catalog invisibility in a particular live session is not explained by that role helper alone. No live account/session diagnosis was performed here.
3. **There already is an order-scoped write endpoint**: `inventory/scoped-one-time-inventory.controller.ts` → `ScopedOneTimeInventoryService.issueToOrder/loadAccessibleOrder`. It permits global issuers OR an active `one_time_manager` assignment. The selected order fields omit `status`; that function does not enforce open-order lifecycle. It locks the item and checks stock, but this inspected path has no request-key replay check and checks assignment before the item transaction. It needs current policy, deny precedence, order/assignment lifecycle recheck and idempotency. Do not build a duplicate path based on the global helper alone.
4. `features/one-time-order-inventory/ui/one-time-order-inventory-panel.tsx` accepts only `items` and renders history; no issue action/form. `app/(app)/settings/page.tsx` is an EmptyState placeholder; `shared/ui/app-shell/app-header.tsx` links settings. Neither is a founder access administration flow yet.
5. Source reconstruction finds **51 distinct catalog codes** across seed and permission INSERT migrations. Seed alone contains 30. This is a static reconstruction, not a query of the current production database. Several old codes have no runtime authorization consumers, while `object.budget_edit` and `objects.substitution.manage` are live checks absent from those 51. `object.daily_rate_edit` exists in contracts but no inspected runtime check consumes that literal.
6. Approval authority cannot be inferred from generic global booleans: `approvals/utils/approval-capabilities.util.ts` gives broad inventory capability, while type-specific inventory exception dispatch uses director OR `approval.resolve_inventory_exception`. `approval.resolve_task_result` is cataloged but task resolver dispatch actually checks leadership. These are real baseline discrepancies requiring explicit treatment, not silent normalization.
7. `chats/chat-realtime.service.ts::handleRedisEvent` sends by precomputed recipient IDs and connected user ID without current policy evaluation; authentication occurs at upgrade. `notifications/notifications.service.ts` mostly enforces recipient and dismissal, with a special direct-permission candidate deny. Object deny/revocation needs more than HTTP/menu updates.
8. `users-access/users-access.service.ts` independently authorizes user pickers by role, creator, object assignment and delegation; centralizing mutation handlers alone leaves different discovery rules. FilesService independently reproduces parent policies for 16 attachment types.

Recommended B contract (proposal; B owns actual API): `decide(subject, operation, resourceContext)` and `scopeWhere(subject, operation, entityKind)` must use the same resolver; return effective allow/deny, normalized scope, sources, denied ancestors, dependencies, invariants/blockers, support/connection state and policyVersion. A scalar global capability must not mean access to every resource. Use resource capabilities for buttons, field visibility and server mutations. Parent module deny must stop role/creator/assignment/delegated child grants without forcing unrelated parent entity access (order scope is not object scope).

Catalog metadata needs `code`, localized title/description/module, `allowedScopes`, resource type, dependencies, legacy sources, delegation eligibility, support state, consumers and test references. Preview needs exact effective before/after scopes, ineffective child grants, sensitive authority warnings and current version. Save needs reason, expected version, transactional reevaluation, audit and a fresh capabilities signal. Default removes a personal override; it does not revoke role inheritance. Founder-only administration and last-active-admin protection are mandatory. Approval eligibility and independent approval remain separate from a grant to initiate a change.

## Scope and classification vocabulary

Proposed canonical namespace is plural except already meaningful legacy codes; the aliases table below preserves old codes. These names are recommendations, not code that already exists. Do not silently remap legacy rows to broad new grants.

| Token | Meaning and limits |
| --- | --- |
| `self` | Actor's own account/calendar/message/plan/completion; not another User's ledger. |
| `created` | Entity created by the actor; preserve explicit legacy creator bypasses as a separate source. |
| `assigned` | Active canonical object/order/task/candidate assignment applicable to this action; not every assignment type. |
| `selected` | Explicit set of IDs of the operation's resource type. Proposed only when consumer can filter/recheck those IDs; unsupported until implemented. |
| `all` | All eligible resources for that operation, still subject to lifecycle, private fields and independent approval. |
| `visible` | Intersection with effective parent read scope; a derived dependency, not a standalone broad grant. |
| `member` | Current room membership with membership-history visibility boundary; not module-wide chat access. |
| `participant` | Creator/assignee/explicit viewer/target participant as defined by the task policy. |
| `delegated` | Derived object-scoped source, time bounded; never a user-selectable global scope or added system role. |
| `global` | Non-resource action (login, module entry, catalog administration); no arbitrary selected/self scope. |

Scopes listed in operation tables are **allowed scope designs**, not implemented support. Each adapter must reject unsupported selections rather than treating them as all. `all` on a read does not grant private fields or money editing. Default source = exact old helper/query rule; zero overrides must preserve its effective outcomes, with separately documented approved drift fixes.

Classification: **A** manageable authorization; **I** lifecycle/data/business invariant preserved independently; **R** restricted authority/product exception requiring explicit decision if the eligible circle changes; **U** unsupported/absent capability or unresolved behavior. Mixed A+I means an action is configurable but its invariant is not bypassed by a grant. No checkbox for a U operation until implementation is available.

## Existing 51 catalog entries: reconciliation

Sources: `apps/backend/prisma/seed.ts:112` and permission INSERT statements under `apps/backend/prisma/migrations`. Paths in this table are under `apps/backend/src/modules` unless noted. "No runtime consumer found" means targeted literal search under backend/frontend/shared sources found no authorization check, not proof that dynamic consumers can never exist. Role defaults below are source defaults; database-specific drift is unverified.

| # | Existing code | Effective legacy source / consumer | Proposed mapping, scopes and action |
| --- | --- | --- | --- |
| 1 | `auth.login` | Seed label; no runtime permission check found in login | `auth.login` global A+I; wire active-user/password/session checks; never make last founder unable to recover. |
| 2 | `objects.read` | Seed; actual object reads use role/creator/assignment/delegation | Alias `objects.view` created/assigned/selected/all; do not assume this row gates reads today. |
| 3 | `objects.create` | Seed; actual helper leadership-only | `objects.create` global; preserve leadership baseline. |
| 4 | `objects.update` | Seed; actual helper leadership + contextual delegation | Alias `objects.core.edit` selected/all with parent visibility. |
| 5 | `inventory.catalog.delete` | Inventory access helper: leadership OR permission; delete/restore service | `inventory.items.delete`, `inventory.items.restore` selected/all; history/stock/reference blockers I. |
| 6 | `equipment.unit.delete` | Equipment access helper: leadership OR permission | `equipment.units.delete` selected/all; unused-error deletion restrictions I. |
| 7 | `tasks.read` | Seed; actual task access query does not consult literal | Alias `tasks.view` participant/selected/all. |
| 8 | `tasks.create` | Seed; active user and target access | `tasks.create` global or target selected/assigned; cannot use global grant to select inaccessible target. |
| 9 | `tasks.update` | Seed; actual creator/delegation lifecycle checks | Split `tasks.body.edit`, `tasks.assignees.manage`, lifecycle codes below. |
| 10 | `timesheet.read` | Seed; actual wide-role/object-scope query | Alias `timesheets.view` assigned/selected/all. |
| 11 | `timesheet.attendance.edit` | Seed; no literal runtime check found | Attendance operations, not money: `objects.attendance.edit` / `orders.attendance.edit`. |
| 12 | `timesheet.amount.edit` | Seed; no literal runtime check found | Alias only after choosing explicit `timesheets.amount.correct`; do not bypass historical approval. |
| 13 | `accountability.issue_cash` | Permission check, seed founder/director grants | Keep alias to `accountability.funds.issue` selected/all recipient accounts; eligible circle R, no self-invented transfer. |
| 14 | `accountability.review` | Permission-based administrative reading; seed leadership | `accountability.accounts.view` all, separate from self and order aggregate. |
| 15 | `expense.approve` | Expense approval; seed leadership | `expenses.approve` selected/all, independent author rule I/R. |
| 16 | `accountability.closure.approve` | Own dedicated resolver, seed leadership | `accountability.closures.resolve` selected/all; immutable attempt/history I. |
| 17 | `accountability.correct_receipt` | Founder/director seed; receipt/payment correction checks | `accountability.receipts.correct`, `orders.payments.correct` selected/all; compensating ledger operation I/R. |
| 18 | `approval.resolve_task_result` | Catalog/contract; runtime resolver checks leadership instead | `approvals.task_result.resolve` selected/all; discrepancy tracked; do not claim direct grant works. |
| 19 | `approval.resolve_object_change` | Leadership OR explicit permission; equipment writeoff shares it | Split `approvals.object_change.resolve`, `approvals.equipment_writeoff.resolve`; preserve old coupling until deliberate migration. |
| 20 | `approval.resolve_inventory_exception` | Type-specific capability; shared writeoff and photo exception | Split `approvals.inventory_missing_photo.resolve`, `approvals.inventory_writeoff.resolve`; director-only photo contract vs permission override is R. |
| 21 | `timesheet.manual_correction` | Role/capability in approval resolver; timesheet service paths | `timesheets.amount.correct` and `approvals.timesheet_exception.resolve` separated; initiating != approving. |
| 22 | `one_time_order.review.edit` | Capability is literal permission; seed leadership | `orders.reviews.edit` visible; conflicts with contract allowing any order reader; explicit drift fix/test needed. |
| 23 | `one_time_order.review.view_all` | Wide roles OR permission; deputy_director seed | `orders.reviews.view` visible/all; review-only projection cannot unlock order money. |
| 24 | `one_time_order.calendar.approve_availability` | Calendar/approval services; seed leadership+HR | `calendar.orders.availability.resolve` selected/all managers, independent approval I/R. |
| 25 | `one_time_order.calendar.manage` | Calendar service; seed leadership+HR | `calendar.orders.availability.manage` selected/all managers, separate from order edit. |
| 26 | `user_absences.view_all` | Historical calendar permission; current list exposes free/busy to active Users | `calendar.users.view` self/all busy-only. Exact remaining legacy consumers must be checked before removal. |
| 27 | `user_absences.manage` | `UserAbsencesService.assertCanManageTarget`; personal Kireeva grant migration | `calendar.users.events.create/edit/delete` self/selected/all; foreign edits require grant. |
| 28 | `user_absences.view_private_reasons` | Response mapping strips foreign comments without permission | `calendar.users.private_reasons.view` self/selected/all; also protects foreign reason writes. |
| 29 | `one_time_order.manage_all` | Role OR permission full-management helper | Split order read/core/finance/status/managers/link operations; preserve current bundle as legacy source, not new scope inheritance. |
| 30 | `chat.room.close_global` | Direct personal permission; no broad-role fallback | `chats.rooms.close_global` member/selected; source grant retained; not delete audit/history. |
| 31 | `employees.view` | HR permission helper, registry/card/search/attendance | `employees.view` selected/all; broad employee attendance history question OQ-141 remains. |
| 32 | `employees.create` | Dedicated permission; candidate conversion also requires it | `employees.create` global; no automatic User/object assignment. |
| 33 | `employees.edit` | Dedicated permission; employee/schedule mutations | `employees.edit` selected/all; split sensitive sections and operations below. |
| 34 | `employees.archive` | Dedicated permission | Keep selected/all; lifecycle/version/dependencies I. |
| 35 | `employees.restore` | Dedicated permission | Keep selected/all. |
| 36 | `employees.delete_permanently` | Dedicated destructive permission | Keep selected/all with dependency/history blockers; no blanket management alias. |
| 37 | `employees.assignments.manage` | HR helper, staffing and scheduling reference checks | Keep selected/all employees intersect selected/assigned objects; assignment action must check both sides. |
| 38 | `employees.assignments.delete_error` | Employee assignment-history destructive path | Keep selected/all; error-only semantics/reason/history restrictions I. |
| 39 | `objects.view_hr` | Basic profile helper + search; migration HR role | `objects.profile.view` selected/all with restricted projection; no operational sections by implication. |
| 40 | `candidates.view` | Shared helper/query; all candidates, default-own registry filter | Keep all; selected scope proposed only with query support, assignment not required for read. |
| 41 | `candidates.manage` | Helper requires view and no deny | Split create/edit/status/archive/restore/assign/convert; manager feedback does not close another SLA. |
| 42 | `candidates.respond` | View + respond/manage, then active assignment unless management feedback | `candidates.responses.create` assigned/all-feedback; preserve assigned response vs HR feedback semantics. |
| 43 | `counterparties.view` | Dedicated helper | Keep selected/all; children retain object scope. |
| 44 | `counterparties.manage` | Dedicated helper | Split create/edit/archive/restore; defaults mapped from legacy bundle. |
| 45 | `counterparties.link_objects` | Dedicated helper; link/unlink/master actions | `counterparties.objects.link/unlink`, `counterparties.master.set/unset`; both entity scopes. |
| 46 | `candidates.denied` | Special deny implemented as positive direct permission; Stepanova/Nikitina migration | Migrate to explicit `candidates.view` parent deny with source/history; keep deny across UI/API/search/notifications/assignee eligibility. |
| 47 | `objects.hr_reports_view` | Report/history-only personal grant Lazutina/Kireeva; recursive redaction | `objects.reports.view`, `objects.history.view` selected/all restricted fields; no comments/arrival/attendance write. |
| 48 | `visit_plans.manage` | Personal Lebedev/Gorbacheva permission in service | Split plan/entry/visit/report/deadline operations; self/selected/all managers; no leadership default mutation. |
| 49 | `one_time_order.escorts.manage` | Personal Drozdovsky/Berendyakov grant | `orders.escorts.edit` self intersect visible orders; current team/date and nonempty list I. |
| 50 | `chat.room.manage_members` | Personal Stepanova/Lebedev; admin paths remain | `chats.members.add/remove` member/selected; no rename/history deletion/foreign-room discovery. |
| 51 | `object.coefficient_edit` | Explicit permission; Lebedev/Gerasimov migration | `objects.coefficient.edit` selected/all parent-visible; value is stored only, formula OQ-148 U. |

Additional live/contract codes outside reconstructed 51: `object.budget_edit` is consumed by object setup/planning and team-fund administration; `objects.substitution.manage` by substitution administration; `object.daily_rate_edit` is a contractual capability without a found runtime literal consumer. Register these distinctions explicitly; a new catalog must not silently discard the live checks or expose an ineffective toggle.

Default/grant evidence: `20260828100000_employee_model_permissions` defines HR lifecycle grants and object basic access; `20260829130000_candidates_notifications_foundation` defines candidate role grants; `20260914190000_counterparties_foundation`; `20261008110000_user_calendar_access_and_audit` personal calendar migration; `20261025120000_candidate_access_exclusions`; `20261026100000_remaining_operations:272` personal reports/plans/escorts/chat memberships; `20261028120000_object_scheduling:85` coefficient. Earlier inventory/equipment/deputy-director documentation is contradictory: preserve actual helper baseline and list contract drift explicitly rather than restoring an obsolete OQ-045/OQ-048 restriction.

## Granular operation matrix and traceability

All backend paths below begin `apps/backend/src/modules/`; frontend paths begin `apps/frontend/src/`. Each backtick-separated code is an individual proposed catalog entry. Descriptions identify separate operations even where the current implementation bundles them. Table scopes apply only to actions on that row. Global/module entry is distinct from record rights but cannot be used to bypass parent deny. Exact route evidence is in the generated appendix; no unstated endpoint is promised.

### Identity, users, settings, dashboard

| Operations / purpose | Scopes; legacy default and classification | Server / UI / required verification |
| --- | --- | --- |
| `auth.login`, `auth.refresh`, `auth.logout`, `auth.me.view` | global/self; active user + password/session/cookie flow A+I | `auth.controller.ts`, `auth.service.ts`, `auth-sessions.service.ts`, jwt strategy; `shared/auth/auth-client.ts`, `auth-session.ts`. Session expiry/revocation, disabled user and fresh-policy tests; do not use stale role claim. |
| `users.options.view` | Purpose-specific selected/visible; explicit `purpose` required A | `users-access.service.ts::listUsers`, object-manager/responsible/task-assignee/task-visibility/order-manager/payment-recipient/chat-participant branches; selectedId and search cannot bypass eligibility. No generic directory grant from an order-read grant. |
| `dashboard.leadership.view`, `dashboard.manager.view`, `dashboard.hr.view`, `dashboard.operations.view` | all vs assigned/self source as existing service; role variants A | Four `dashboard/*dashboard.service.ts` have role gates; controller also adds absence aggregate; `features/dashboard/ui/dashboard-role-router.tsx`. Child data needs effective module scopes; overview cards/counts must not leak denied objects/people/finance. `leadership-dashboard.integration.test.ts` exists, coverage of new deny unknown. |
| `settings.view` | global U: placeholder currently; no functioning settings administration | `app/(app)/settings/page.tsx`. Do not label connected. |
| `access.catalog.view`, `access.users.view`, `access.user.view`, `access.preview`, `access.manage`, `access.history.view`, `access.assignments.view` | founder-only global/selected target users A+I/R; new functionality U until B/C implementation | B API + C window; last active administrator, concurrency, reason, immutable audit, session update, unsupported-code rejection. No create-user/delete-user/reset-password endpoint found in inspected Auth/UsersAccess controllers; do not expose those as supported operations. |

### Objects, setup, planning, operating sections, scheduling and compensation (D)

| Operations / purpose | Scopes; baseline and classification | Consumers and verification |
| --- | --- | --- |
| `objects.view`, `objects.profile.view`, `objects.registry_signals.view` | created/assigned/selected/all; wide leadership+deputy_director, creator, active assignment, delegated view; HR restricted profile A | `objects.service.ts`, `object-registry-signals.service.ts`, `utils/object-access.util.ts::canViewObjectByScope/canViewObjectBasicProfile`; registry/card/search/dashboard and linked references must share scope. |
| `objects.create`, `objects.core.edit`, `objects.status.change`, `objects.frozen.override` | create global; edit/status selected/all, frozen override founder/director baseline A+I/R | Helpers leadership; status/assignment approvals in ObjectsService; minimum one responsible, create-first material flow, archived/frozen checks stay I. `object-access`, `object-creation-bundle`, `approvals-wave2` tests. |
| `objects.responsibles.add`, `objects.responsibles.remove`, `objects.managers.add`, `objects.managers.remove` | selected/all objects; leadership + eligible delegated assign A+I/R | `objects.controller.ts`, service assignment handlers; `users-access` candidate pickers; target canonical role and active User eligibility I; preserve shared approval where required. |
| `objects.history.view` | visible/selected/all with operational or special reports-only projection A | `/objects/:id/audit`, report feed/history; `object-visibility.util.ts` and recursive financial redaction. Audit is read only; permission does not grant audit edit. |
| `objects.setup.view`, `objects.setup.edit`, `objects.contract_amount.view`, `objects.contract_amount.edit`, `objects.budget.view`, `objects.budget.edit`, `objects.coefficient.view`, `objects.coefficient.edit` | selected/all parent visible; contract amount leadership only; budget edit founder/director or `object.budget_edit`; coefficient edit explicit capability A+I/R | `object-setup.service.ts::capabilities`, field-level patch authorization, `publicSetup/map` projection; check nested setup, audit JSON, create/copy response and history. Coefficient formula unsupported OQ-148; no arithmetic inferred. |
| `objects.contacts.view`, `objects.contacts.create`, `objects.contacts.edit`, `objects.contacts.delete` | visible/selected/all; core edit controls writes A+I | `object-planning.service.ts`, `/objects/:id/contacts`; versions and safe contact phone/email/link data, no unrelated Employee/User merge. |
| `objects.planning.view`, `objects.planning.seasons.edit`, `objects.planning.budget.edit` | selected/all; operational read, rate-management for seasons, budget right for budget A+I | `ObjectPlanningService.getPlanning/updatePlanning`, calendar Moscow/season validation, independently protected payload fields. `object-planning.integration.test.ts`. |
| `objects.arrival.view`, `objects.arrival.create`, `objects.reports.view`, `objects.reports.save_draft`, `objects.reports.submit`, `objects.reports.attach`, `objects.reports.attachments.correct` | visible/assigned/selected/all; broad operational vs report-only HR; correction author OR actual report edit A+I | `object-operations.service.ts`, `object-attendance-submission.service.ts`, `object-daily-report-publication.service.ts`; immutable publication revisions/outbox/idempotency/reason; `files.service.ts::assertDailyReportWritable` currently denies reports-only grant explicitly. Re-evaluate both source and recipients for report publication. |
| `objects.comments.view`, `objects.comments.create`, `objects.feed.view`, `objects.linked_orders.view` | visible/assigned/selected/all; operational scope, not basic HR profile A | ObjectOperationsService; no object chat; linked order projection must intersect separate order rights and finance fields. |
| `objects.staffing.view`, `objects.staffing.add`, `objects.staffing.remove`, `objects.employee_options.view`, `objects.substitutions.create` | assigned/selected/all; view/operations plus employee assignment permission where required A+I | ObjectOperationsService employee directory/staffing/substitution handlers and EmployeesService; global HR assignment privilege must not implicitly give object operations or confidential Employee fields. |
| `objects.attendance.view`, `objects.attendance.edit`, `objects.extra_shift.create`, `objects.attendance.rate_override` | assigned/selected/all; attendance own operational scope; extra shift active manager; rate override founder/director baseline A+I/R | `object-operations.service.ts`, attendance submission, TimesheetsService sync; frozen/edit window/reason, unavailable employee override, no duplicate paid day. Delegated general operations do not automatically give payroll/HR. |
| `objects.rates.view`, `objects.rates.defaults.edit`, `objects.rates.create`, `objects.rates.edit`, `objects.employee_rates.assign` | selected/all; read operational; reusable rate writes leadership+deputy_director, separately from exceptional attendance override A+I | Compensation routes in ObjectOperationsController; default/summer/winter/pay option, employee-rate policy; no historical recomputation. |
| `objects.scheduling.view`, `objects.positions.create`, `objects.positions.edit`, `objects.positions.archive`, `objects.scheduling.preview`, `objects.positions.pay_condition.select`, `objects.scheduling.employee_options.view` | assigned/selected/all parent-visible; current operational own scope; pay selection rate-manager OR active object manager A+I | `object-scheduling.service.ts::access/list/selectPayConditions/validateReferences`; uses `ownScopeOnly:true`, excluding delegation deliberately for HR/payroll; assignment changes also require `employees.assignments.manage`. Existing active pay-condition belongs to this object. |
| `objects.pay_contours.view`, `objects.pay_contours.create`, `objects.pay_contours.edit`, `objects.shifts.view`, `objects.shifts.confirm`, `objects.shifts.cancel` | assigned/selected/all; rate-gated contours; operational confirm/cancel A+I | Scheduling controllers/service, write-lock current object, revisions, active references, date window and historical financial approval. Planning is not attendance. |
| `objects.compensation.view`, `objects.compensation.versions.create`, `objects.compensation.versions.cancel`, `objects.team_fund.edit`, `objects.compensation.adjustment.request`, `objects.extra_work.correct`, `objects.compensation.explanation.view` | selected/all; reusable rate management vs founder/director+budget team fund; extra work active manager exception A+I/R | `object-compensation.service.ts`, scheduling `adjustCompensation/applyFinancialDecision`; versions current/future, pending historical request, no author self-approval, one paid fact per contour/date, accrual != payout. `object-compensation`, `object-scheduling`, `team-compensation-acceptance` tests. |

### Orders and separate order calendar (D)

| Operations / purpose | Scopes; baseline and classification | Consumers and verification |
| --- | --- | --- |
| `orders.view`, `orders.create`, `orders.copy`, `orders.operational.edit`, `orders.financial.view`, `orders.financial.edit`, `orders.linked_object.change` | created/assigned/selected/all; wide leadership+deputy_director or manage_all; create also manager/senior_manager, not operation_manager; financial edit full management/creator A+I | `utils/one-time-order-access.util.ts`, `one-time-order-capabilities.util.ts`, OrdersService mapper and patch field groups; object visibility remains independent. **Financial view exact legacy payload breadth needs field-by-field review**; do not infer it from financial edit. |
| `orders.status.change`, `orders.complete`, `orders.reopen`, `orders.completions.view`, `orders.payments.correct`, `orders.managers.add`, `orders.managers.remove` | created/assigned/selected/all; action-specific full/creator/assigned gates A+I/R | Order service complete/reopen/payment correction, UsersAccessService manager/payment-recipient pickers, completion payment visibility. R: generic capability allows scoped operational reopening but specification contract says leadership-authorized reopen; reconcile explicitly. Cycles/payments/idempotency remain intact. |
| `orders.reviews.view`, `orders.reviews.edit`, `orders.reviews.delete` | visible/selected/all review projection; current edit literal permission A+R | Review registry and PATCH/DELETE routes; contract grants text review to any order reader. Test approved correction rather than silently treating current permission as intended rule. |
| `orders.spec_catalog.view`, `orders.spec_catalog.create`, `orders.spec_catalog.edit`, `orders.spec_catalog.archive`, `orders.spec_templates.view`, `orders.spec_templates.create`, `orders.spec_templates.edit`, `orders.spec_templates.archive` | global catalog, selected/all item/template mutations; leadership-only A+R | `one-time-order-specification-catalog.service.ts::assertLeadership/assertCanRead`; no generic manager access. Eight individual actions, not one umbrella permission. |
| `orders.specification.view`, `orders.specification.apply_catalog`, `orders.specification.create`, `orders.specification.edit`, `orders.specification.reorder`, `orders.specification.remove` | visible for read; selected/all parent-visible leadership composition A+I/R | Order specification routes/service; snapshot text and catalog changes do not rewrite history. Catalog access alone does not compose an order. |
| `orders.specification.complete`, `orders.specification.reopen`, `orders.specification.comments.view`, `orders.specification.comments.create`, `orders.specification.files.attach`, `orders.specification.files.detach` | read visible; mutate **assigned** active `one_time_manager` only, even leadership requires assignment A+I/R | `assertActiveSpecificationManager`/execution checks, FilesService specification-item path; order open, optional evidence, idempotent comment, detach link only. Selected/all grant cannot override active-executor invariant without explicit product rule change. |
| `orders.comments.view`, `orders.comments.create`, `orders.reports.view`, `orders.reports.edit`, `orders.photos.view`, `orders.photos.add`, `orders.photos.delete`, `orders.photos.restore`, `orders.history.view`, `orders.tasks.view`, `orders.equipment.view` | created/assigned/selected/all; operational capabilities, own-photo branch, separate history projections A+I | Order comments/report/photo/history/history-page/task/equipment routes; photo soft delete/restoration reason/audit, attachments and files parent authorization. |
| `orders.workforce.view`, `orders.workforce.add`, `orders.workforce.remove`, `orders.workforce.payment.edit`, `orders.attendance.view`, `orders.attendance.edit`, `orders.attendance.coverage.view`, `orders.timesheet.view`, `orders.timesheet.export`, `orders.payouts.view` | created/assigned/selected/all order; payout self-account vs separately authorized finance aggregate A+I | `one-time-order-workforce.service.ts::assertReadable/assertWritable` and report/export, workforce directory controller/service. Payout query at ~648 filters account owner unless `accountability.review`; preserves approved/reconciled vs draft/submitted and order/workCycle/date/Employee. No automatic cash-formula change OQ-144. |
| `orders.escorts.view`, `orders.escorts.edit`, `orders.service_lines.view`, `orders.service_lines.edit`, `orders.deadline.view`, `orders.deadline.edit`, `orders.attention.view` | visible order; escorts self+personal grant, service-line edit financial, deadline operational A+I | `one-time-order-operations.service.ts`, attention service; team/date eligibility/nonempty escorts, atomic components sum, explicit deadline not guessed. |
| `calendar.orders.view`, `calendar.orders.export`, `calendar.orders.managers.view`, `calendar.orders.conflicts.check`, `calendar.orders.availability.create`, `calendar.orders.availability.edit`, `calendar.orders.availability.cancel`, `calendar.orders.availability.manage`, `calendar.orders.availability.resolve`, `calendar.orders.private_comments.view` | self/configured calendar manager, selected/all via legacy manage/approve; visible-order details independent A+I/R | Order calendar/manager availability/conflict services and separate roster util; hidden-order busy projection, HR/self/admin private comments, approvals and version conflicts. `features/one-time-order-calendar/ui/one-time-order-calendar.tsx` has local role checks. Calendar busy read must not unlock order cards. |

### Warehouse, counterparties and accountability (D)

| Operations / purpose | Scopes; baseline and classification | Consumers and verification |
| --- | --- | --- |
| `inventory.view`, `inventory.items.view`, `inventory.stock.view`, `inventory.items.create`, `inventory.items.edit`, `inventory.items.archive`, `inventory.items.delete`, `inventory.items.restore` | read global eligible role baseline, selected/all items proposed; catalog write leadership+deputy_director, delete leadership OR permission A+I | Inventory helper/service, item capabilities; historical stock/reference/version blockers. Scoped issue item options must be accessible without granting catalog management/global history. |
| `inventory.movements.view`, `inventory.reports.view`, `inventory.receipt.create`, `inventory.issue_object.create`, `inventory.issue_order.create`, `inventory.return.create`, `inventory.writeoff.create`, `inventory.adjustment.create`, `inventory.movements.correct` | global selected/all plus assigned/selected target for issue/correction; global helper broad operators; object-specific active manager/delegation; scoped order route active manager A+I | InventoryController additionally gates movements/reports with `canViewInventoryReports`; generic and scoped write services differ. Distinct request action per movement type; correct pending cancel vs applied compensating return. Stock lock, price snapshot, evidence/approval/idempotency I. |
| `inventory.references.objects.view`, `inventory.references.orders.view`, `inventory.missing_photo.resolve` | action-target reference projection; resolution director baseline R | Picker ability must not open target card; scoped issue requires actual current target lifecycle. `resolve-missing-photo-approval` direct route vs shared approval permission discrepancy must be reconciled. |
| `counterparties.view`, `counterparties.references.view`, `counterparties.create`, `counterparties.edit`, `counterparties.archive`, `counterparties.restore`, `counterparties.history.view`, `counterparties.inventory.view` | selected/all counterparty; legacy view/manage/link permissions A+I | CounterpartiesService, history/history-page, aggregate inventory query; linked object denial still applies to projected name/address/files/movements and master hub. |
| `counterparties.objects.link`, `counterparties.objects.unlink`, `counterparties.master.set`, `counterparties.master.unset` | selected/all counterparty intersect relevant object; dedicated link right A+I | One master per counterparty, no master warehouse/transfer; cross-entity target/reference checks and audit. |
| `accountability.self.view`, `accountability.accounts.view`, `accountability.order_summary.view`, `accountability.recipient_options.view` | self/selected/all accounts; own role/active assignment/historical receipt paths vs review permission A | AccountabilityService/access/capabilities, `/me`, accounts, order summary; self external-receipt contract broader than `canViewOwnAccountability` baseline: explicitly test nonmanager active User. Order aggregate != foreign personal ledger. |
| `accountability.funds.issue`, `accountability.external_receipt.create`, `accountability.receipts.reverse`, `accountability.receipts.correct` | issue selected/all recipients with restricted authority; external receipt **self**; reverse/correct exact source account A+I/R | Funding/reverse/payment correction paths; external immediate credit requires source/comment, no amount/day limit, automatic order receipt never duplicated; posted finance immutable, use compensating entry. |
| `expenses.create`, `expenses.edit`, `expenses.submit`, `expenses.approve`, `expenses.reject`, `expenses.employee_payout.create`, `accountability.closures.request`, `accountability.closures.resolve` | draft/submit self; approve/reject selected/all separate authority A+I/R | Same account owner and allowed states; employee payout Employee/order/cycle/date, evidence exception per current contract, independent approval; closure attempt approves once and reactivates account. Tests in accountability suites + order-accountability suites, none run. |

### Secondary backend adapters (A next phase; no implementation claim)

| Operations / purpose | Scopes; exact legacy rule / classification | Policy consumers and tests/gaps |
| --- | --- | --- |
| `tasks.view`, `tasks.history.view`, `tasks.completions.view`, `tasks.references.view` | participant/selected/all A | `tasks/utils/task-access.util.ts::buildTaskAccessWhere` ORs creator, active assignee, explicit visibility, all_users, object target_participants, order assignment, delegated task scope; leadership wide. Must protect direct task and target-linked lists; child target module deny must not leak target fields/history/files. `task-access`, `task-flow`, `global-search` suites. |
| `tasks.create`, `tasks.body.edit`, `tasks.assignees.add`, `tasks.assignees.remove`, `tasks.status.change` | create active user with target read; body/assignees **created** or delegated creator; selected/all only explicit new rule A+I | `tasks.service.ts::create/update/assertTaskCreator`, target access and visibility selection; own assignment completion does not grant task-body editing. User pickers are separate consumer. No silent leadership body-edit expansion. |
| `tasks.completion.save_draft`, `tasks.completion.submit`, `tasks.completion.undo`, `tasks.result.submit` | assigned self active TaskAssignee A+I | `assertActiveAssignee` and completion requirement handlers; evidence/text requirements and terminal status I, retain own actor. File task-assignee-completion read vs write differs. |
| `tasks.confirm`, `tasks.complete_now`, `tasks.return_to_work`, `tasks.reopen`, `tasks.cancel` | created/selected/all based on creator/leadership/delegated lifecycle A+I/R | `assertLifecycleManager`, response capabilities ~2380, shared approval and auto-close service. Completing assignment vs confirming all results are distinct; terminal state, other assignees and independent confirmation requirements remain. `task-auto-close` and approval tests. |
| `employees.view`, `employees.references.positions.view`, `employees.references.objects.view`, `employees.object_candidates.view`, `employees.attendance.view`, `employees.assignment_history.view` | selected/all Employee; view permission, attendance broad scope currently A+R | `employees.service.ts`, `employee-schedule.service.ts`, `employee-assignment-history.service.ts`, HR helper; Employee attendance/history can expose other objects under current view right. OQ-141 needs business confirmation; do not declare narrowed object scope implemented. |
| `employees.create`, `employees.edit`, `employees.status.change`, `employees.archive`, `employees.restore`, `employees.delete_permanently` | global create, selected/all mutation; dedicated grants except status via edit A+I | Employee registry/card and lifecycle handlers; document received flags server date/actor, no User account creation. `employee-access-matrix`, `employee-destructive-actions`, `employee-documents`, `employee-registry-hardening` tests. |
| `employees.availability.create`, `employees.availability.edit`, `employees.availability.delete`, `employees.substitutions.create`, `employees.substitutions.edit`, `employees.schedule.edit` | selected/all via edit permission; HR process A+I/R | EmployeeScheduleService; availability is not attendance, substitute overlap/availability conflicts preserve current behavior (OQ-142 unresolved blocking vs warning), no unapproved history rewrite. `employee-schedule-conflicts`, `employee-attendance-calendar` tests. |
| `employees.assignments.manage`, `employees.assignments.remove`, `employees.assignments.delete_error` | selected/all Employee AND target object; dedicated assignment/delete-error grants A+I | EmployeesService + assignment-history service; canonical Employee lifecycle, reference scope, audit, history deletion blockers. `employee-hr-object-access`, `employees-hr` tests. |
| `candidates.view`, `candidates.manager_options.view`, `candidates.create`, `candidates.edit`, `candidates.status.change`, `candidates.archive`, `candidates.restore`, `candidates.assignments.manage` | read all if view/no denied; manage with view; selected proposed only with scopeWhere A+I/R | `candidates.service.ts`, candidate helper; manager defaults own/all is filter, not security restriction; eligible manager active `manager`/`operation_manager`, no denied users. Personal deny must override role grants everywhere. |
| `candidates.responses.create`, `candidates.feedback.create`, `candidates.convert_employee` | own active assignment response, management feedback, conversion manage AND employee-create A+I | Manager feedback SLA belongs to assignment, other feedback cannot close it; conversion atomic/idempotent, no EmployeeObjectAssignment or User implicitly; `candidate-reopen-conversion`, `candidates-multi-manager`, `candidate-notifications` tests. |
| `equipment.view`, `equipment.catalog.view`, `equipment.catalog.create`, `equipment.catalog.delete`, `equipment.units.view`, `equipment.units.create`, `equipment.units.delete`, `equipment.history.view` | catalog/module read leadership+deputy_director+manager/senior/operation; write leadership+deputy; unit delete leadership OR dedicated permission; history operators only A+I | EquipmentService/helper/capabilities; `/catalog`, `/units`, unit movements. Do not use read capability for upload/move. `equipment.integration`, `catalog-deletion` tests. |
| `equipment.assign_object`, `equipment.assign_order`, `equipment.return`, `equipment.move`, `equipment.mark_broken`, `equipment.mark_lost`, `equipment.repair.send`, `equipment.repair.return`, `equipment.writeoff.request`, `equipment.object_scope.view`, `equipment.order_scope.view` | selected/all units intersect assigned/selected target; scoped references distinct from global cards A+I/R | Generic EquipmentService movement dispatch plus `scoped-equipment.service.ts`; source AND destination need current policy on move, current unit state and history I, writeoff approval preserved. `types/equipment.type.ts` confirms eight movement types including `mark_lost`; there is no separate `move` movement enum, so moving between scopes must map to the supported issue/return workflow and must not be exposed as an independent unsupported mutation. |
| `mats.catalog.view`, `mats.catalog.create`, `mats.cost.edit`, `mats.cost_history.view`, `mats.registry.view`, `mats.object.view`, `mats.quantity.edit`, `mats.quantity_history.view` | global active read catalog/cost history; catalog writes wide-object roles; object read scoped, quantity operational/delegated A+I | `rubber-mat-aggregate.service.ts::active/manager/context`, three controllers in aggregate file; quantity optimistic version/snapshot, readiness marker, null cost != zero. `rubber-mats.integration.test.ts`. Legacy individual asset mutations are retired/410; do not expose assign/return/move/service as connected grants. |
| `timesheets.view`, `timesheets.export`, `timesheets.overview.view`, `timesheets.overview.export`, `timesheets.references.objects.view`, `timesheets.references.employees.view`, `timesheets.corrections.view` | assigned/selected/all object scope; wide roles include deputy_director A | TimesheetsService plus access helper; monthly object and overview queries/export must use same final values and scope; employee reference cannot expose denied rows; saved historical rows persist after staffing changes. |
| `timesheets.amount.correct`, `timesheets.exception.request` | selected/all parent-visible; founder/director default correction vs explicit capability, edit window and approval A+I/R | `timesheets.service.ts`, `utils/timesheet-edit-window.util.ts`, shared approval. No historical overwrite solely because founder granted an operation. `timesheet-permissions`, `timesheet-overview`, `timesheet-rate-policy-export`, `financial-history-persistence` tests. |
| `calendar.users.view`, `calendar.users.options.view`, `calendar.users.events.create`, `calendar.users.events.edit`, `calendar.users.events.delete`, `calendar.users.private_reasons.view`, `calendar.users.private_reasons.edit` | read self/all busy, own write self, foreign write/privacy selected/all with personal grant A+I/R | `user-absences.service.ts::list/assertCanManageTarget/canViewPrivateReasons/map`; list users and leadership summary helpers separate consumers. Strip comments before returning; foreign reason edit also requires privacy. No conflation with order calendar. `user-absences.integration`, `calendar-chat-policy` tests. |
| `visit_plans.view`, `visit_plans.manager_options.view`, `visit_plans.object_options.view`, `visit_plans.create`, `visit_plans.entries.add`, `visit_plans.entries.remove`, `visit_plans.visits.record`, `visit_plans.report.edit`, `visit_plans.deadline.edit`, `visit_plans.history.view` | self read OR leadership OR manage; mutation personal manage only, selected/all managers proposed A+I/R | `visit-plans.service.ts::assertRead/assertManage`, listManagers requires manage; object options/addEntry checks target manager and planner; versions/history/explicit deadline. `plans-orders-operations.integration.test.ts`, operational overdue deliveries. No leadership-mutation default from read. |
| `substitutions.view`, `substitutions.options.view`, `substitutions.create`, `substitutions.revoke`, `substitutions.admin` | involved self list/revoke; create own principal; selected/all admin `objects.substitution.manage` A+I/R | `user-substitutions.service.ts::list/options/assertCanCreate/revoke/resolveGrants`, context/interceptor; explicit objects and period, own union delegated, original and actor audit. No chaining-sensitive global inheritance. `user-substitutions.integration.test.ts`. Re-resolve principal AND replacement denies; current grants derive roles without principal override metadata. |

### Approvals, chat, files, search, notifications, realtime (B/main integration)

| Operations / purpose | Scopes; baseline and classification | Consumers and verification |
| --- | --- | --- |
| `approvals.view`, `approvals.detail.view`, `approvals.cancel` | requester/participant/resolver selected/all A+I | `approvals.service.ts` query/detail/cancel authorization; `canAccessApprovals:true` is only global entry, not permission to read every request. Approval payload parent fields require effective field redaction. |
| `approvals.task_result.resolve`, `approvals.object_change.resolve`, `approvals.inventory_missing_photo.resolve`, `approvals.inventory_writeoff.resolve`, `approvals.equipment_writeoff.resolve`, `approvals.accountability_closure.resolve`, `approvals.timesheet_exception.resolve`, `approvals.order_availability.resolve`, `approvals.object_compensation.resolve` | selected/all eligible requests, exact type resolver circle R+A+I | Approval-capabilities dispatch and `ApprovalsService.approve/reject/cancel`; pending state, self-exclusion where required, current eligible resolver, resource version/idempotency and applied effect checked in transaction. Inventory/equipment return approval types appear in contracts but are not in inspected dispatch list: U, do not present working toggles. |
| `chats.view`, `chats.rooms.view`, `chats.rooms.create_direct`, `chats.rooms.create_group`, `chats.rooms.rename`, `chats.members.view`, `chats.members.add`, `chats.members.remove`, `chats.rooms.hide`, `chats.rooms.unhide`, `chats.rooms.leave`, `chats.rooms.close_global` | member/selected rooms; general entry all, group/admin leadership+deputy_director, personal members/close grants A+I/R | ChatsService room visibility/assertions + helpers; operational system rooms, leadership room exclusive, objects room denied operation_manager unless leadership; membership grant cannot discover foreign room. Removal/rejoin visibility boundary I. |
| `chats.messages.view`, `chats.messages.send`, `chats.messages.edit`, `chats.messages.delete`, `chats.messages.forward`, `chats.messages.react`, `chats.rooms.read`, `chats.search` | member/visible message, own edit/delete with existing window; source AND destination forward A+I | ChatsController/service message windows/unread-window/direct message/read receipts; own author/time window, parent room current access, attachments; no permission can silently erase shared audit. `chats.integration`, `chat-membership-access` tests. |
| `search.query`, `search.recent.resolve` | effective visible scope of each result kind, global entry A | SearchService::buildAccessContext and each search/resolve branch; object, task, order, Employee, candidate, counterparty, inventory, equipment; return only authorized fields and counts, clear cached recent payload on denial. `global-search`, `approvals-search` tests. New module grants without search support remain explicitly disconnected. |
| `files.list`, `files.metadata.view`, `files.content.download`, `files.view`, `files.thumbnail.view`, `files.preview.view`, `files.preview.retry`, `files.attach` | derived parent-visible/parent-writable intersection; file ID alone grants nothing A+I | FilesController/FilesService/FilePreviewService, safe mapper; see 16-type table below. Recheck on preview retry/content delivery and on transactional attachment completion; unauthenticated storage URLs unsupported. Generic detach/delete route absent; use domain detach only. |
| `notifications.view`, `notifications.unread_count.view`, `notifications.read`, `notifications.read_all`, `notifications.dismiss` | self recipient only A+I | NotificationsService/controller; dismiss read-only notification by its recipient; never delete common event. Filter source visibility/title/body at list/count and delivery, not merely target URL open. `notifications-personal`, `candidate-notifications` tests. |
| `realtime.connect`, `realtime.chat.receive`, `realtime.notification.receive` | self authenticated connection, effective room/source scope at **delivery** A+I | `chat-realtime.service.ts` upgrade + Redis dispatcher; event recipient list is not sufficient current authority. Revalidate user active/current policy, deny, assignment, membership; revocation affects subsequent delivery on already-open socket. No standalone HTTP controller route for websocket upgrade. |

## File-parent policy inventory (main)

`files/constants/file-attachment-policy.constants.ts` currently allows exactly 16 parent types; all `fieldCodes` arrays are empty. Arbitrary entityType/fieldCode must be rejected. These parent readers/writers are independently implemented in `files.service.ts`, not automatically delegated to domain controllers.

| Parent type | Read / write policy anchor and invariant |
| --- | --- |
| `object` | `canReadObject` / `canWriteObjectCore`; object profile read vs core edit; delegated view/edit distinct, archived/frozen lifecycle. |
| `object_arrival_photo` | `canAccessObjectScopedEntity`; parent object operational access, not HR basic profile. |
| `object_daily_report` | Report-only HR projection vs operational; `canWriteDailyReportTarget`, `assertDailyReportWritable`; correction reason/publication revision, no reports-only write. |
| `object_comment` | Object operational read/write; not chat membership. |
| `one_time_order_comment` | `canAccessOneTimeOrderScopedEntity`; effective order read/write. |
| `one_time_order_daily_report` | Same order-scoped entity handler, report lifecycle. |
| `one_time_order_photo` | `canAccessOneTimeOrderPhoto`; deleted photo visibility and owning order action. |
| `one_time_order_specification_item` | `canAccessOneTimeOrderSpecificationItem`; read order, write active assigned manager/open order; attachment optional and detach link only. |
| `task` | `canAccessTask` access query; current writer uses task accessibility, so task-read-only upload difference must be consciously preserved/fixed, not assumed equivalent to body edit. |
| `task_assignee_completion` | `canAccessTaskCompletion`; completion owner/active assignment/terminal state for write, task visibility for read. |
| `one_time_order` | `canAccessOneTimeOrder`; generic order file does not permit financial private-file leakage. |
| `inventory_movement` | `canAccessInventoryMovement`; global role OR object/order scoped read; creator/evidence upload branches need narrow action right and live lifecycle. |
| `equipment_movement` | `canAccessEquipmentMovement`; source/destination object/order scopes and global equipment branch; inspected write branch includes `canAccessEquipment`, which includes read-only manager roles: explicitly review read-vs-write mismatch. |
| `accountability_expense` | `canAccessAccountabilityExpense`; owner/draft vs admin review, no foreign account from order-read grant. |
| `accountability_funding` | `canAccessAccountabilityFunding`; owner/admin read, evidence posting/source immutable rules. |
| `chat_message` | `canAccessChatMessage`; room membership, visible-since boundary, own message write and edit window. |

A file linked to several entities currently succeeds if any readable attachment succeeds (`assertFileReadable`). Define deny semantics for multi-parent files deliberately: an allowed order reference must not reveal an object-confidential artifact through reuse. Proposed per-attachment response filtering plus download policy must match chosen rule; no claim that current OR behavior satisfies parent-deny rollout. File-preview integration/upload suites exist; multi-parent explicit-deny revocation cases need new tests.

## Hardcoded branch ledger and classification decisions

This is the actionable replacement/classification ledger, not an instruction to delete every `if`. Source anchors include helper lists, service assertions, query OR branches and DTO mappers. Code remaining under an A branch must consume resolver decisions; keeping a role branch as a fallback would defeat deny. I conditions remain alongside it. R conditions remain explicit and explainable until a product-approved authority change and tests exist.

| Branch family / source anchor | A: replace as configurable operation source | I/R: retain independently / open item |
| --- | --- | --- |
| `objects/utils/object-access.util.ts` role constants / creator / assignment / delegation OR | Object view/create/core edit/status/rate/frozen action defaults | Active canonical assignment, separate User identity; creator remains source, not magical bypass of deny. Frozen override is separate R action. |
| `objects/utils/object-capabilities.util.ts::buildObjectCapabilities` | Capabilities for sections, reports-history, staffing, attendance and extra shift | Own-only payroll/HR sections vs delegated operational scope, no scalar edit-to-every-field inference. |
| `objects/utils/object-visibility.util.ts`, setup/planning field capability map | Sensitive field read/edit grants | Recursive audit field filtering, null vs hidden distinction; no money rewrite. |
| `object-operations.service.ts` wide/creator/assigned operation checks | Arrival/report/comments/feed/employee/rate/attendance grants | Report publication revision, explicit submit, Moscow day, employee availability, saved historical rate and active manager extra-shift restriction. |
| `object-scheduling.service.ts::access/rateAccess/selectPayConditions/validateReferences` | Position/contour/pay selection/attendance operations | `ownScopeOnly` exclusion for sensitive delegation, existing active option belongs to object, dates/version/payroll approval. |
| `object-compensation.service.ts::rateAccess/canManageTeamFund/list` | Rates/team fund/adjustment/explanation rights | Historical money approval by another leadership User, immutable facts/version, OQ-148 unknown formula. |
| `one-time-order-access.util.ts` full/manage/creator/active assignment OR | Separate read/create/operational/finance/managers/copy/link sources | Order != object; manager eligibility is canonical role restriction R until changed, not broad grant. |
| `one-time-order-capabilities.util.ts` full/creator/activeManager booleans | Resource capabilities and field groups | Execution active manager/open status; leadership composition R; review and reopen discrepancies listed above. |
| `one-time-orders.service.ts::assert*`, photo owner branch, completion/payment mapper | Special order and photo/payment rights | Photo deletion history, cycle and authoritative payment owner, status/version, idempotency. |
| Order calendar/availability service roster and self/admin/privacy branches | Calendar browse/export, own/manage/resolve availability, private comments | Configured roster, overlap/conflict/version, hidden-order busy projection, resolver independence. |
| `inventory-access.util.ts`, InventoryController report check | Catalog/movement/report/resolve default sources | Per-movement type, photo exception authority R; stock, snapshots, posted correction I. |
| `InventoryService.canIssueToSpecificObject/correctMovement`, scoped order service | Target issue/correction and current role/assignment/delegation sources | Recheck entity status and assignment in transaction; no negative stock/double movement; no global adjustment from assigned issue. |
| `equipment-access.util.ts`, EquipmentService, ScopedEquipmentService | Module/catalog/unit/movement/history/delete and scoped move actions | Unit transition validity, both targets, writeoff approval; read module does not automatically mean attach/move. |
| `employee-hr-access.util.ts`, EmployeesService, schedule/assignment history services | Individual Employee rights and subactions | Archive/deletion dependencies/version; User != Employee; sensitive scope OQ-141 and overlap OQ-142 unresolved. |
| `candidate-access.util.ts`, CandidatesService response/assignment logic | Candidate view/manage/respond/feedback/convert | Explicit deny, eligible active manager, assigned SLA answer, atomically create Employee, dedupe notifications. |
| `accountability-access.util.ts`, account service assertions/capabilities | Own account vs admin review/issue/approve/closure/correct actions | Account owner, posted ledger, compensation entries, independent approval, no unauthorized transfer. |
| `approvals/utils/approval-capabilities.util.ts` type switch | Type-specific action eligibility, not one blanket resolve grant | Director-only vs capability conflict R; author exclusion, pending state/version and one effect I. Return types absent U. |
| `tasks/utils/task-access.util.ts`, `TasksService.assertTaskCreator/assertLifecycleManager` | Participant/creator/leadership/delegated sources and task operations | Active assignee, own completion, required evidence, terminal state, confirmation flow. |
| `timesheets/utils/timesheet-access.util.ts`, TimesheetsService | Wide read and money correction sources | Historical saved value and independent approved correction; ownScope/delegated restrictions must not widen payroll. |
| `UserAbsencesService.assertCanManageTarget/map` | Self and personal foreign calendar/privacy operations | Private comments never returned without field grant; overlap and server actor/date I. |
| `VisitPlansService.assertRead/assertManage` | Own/leadership read and personal manage sources | Versions, actual target manager object eligibility and explicit deadline I. |
| `UserSubstitutionsService.isAdmin/assertCanCreate/revoke/resolveGrants` | Own principal/create/revoke, personal admin, per-object delegated actions | Time bounds, no retroactive active-scope edit, current principal/replacement active, no global sensitive inheritance, audit two identities. |
| `RubberMatAggregateService.active/manager/context` | Catalog/cost vs scoped quantity rights | Readiness/version, unknown cost null, immutable quantity/cost history, retired asset mutations stay 410. |
| Chats helpers/ChatsService membership/admin/owner/time branches | Room discovery/admin/member/message operation defaults | Membership history, edit window, source and destination forwarding, objects-role deny and leadership room R. |
| Dashboard role-router/services, AuthService `toMeResponse` capabilities | Dashboard read and global entry capability projection | Effective child filtering, no recomputation from role in UI; no scalar capability-as-resource-permission. |
| SearchService access context; UsersAccessService purpose switch | Search/recent and action-target picker grants | Scope filter + selectedId resolution, metadata/field redaction, separate action target eligibility. |
| FilesService parent switches and write branches | Parent-specific file actions | Valid parent/fieldCode, current visibility/lifecycle, private-file/multi-parent rules; unknown parent denies. |
| NotificationsService recipient/dismiss/candidate direct-deny branches | Notification self controls and source eligibility | Recipient-only state, read-before-dismiss, current source view at list/count/delivery; hardcoded candidate special case alone insufficient. |
| ChatRealtimeService authentication/delivery | Connect and per-message receive policy | Recheck active subject and policy after connection; stale recipient list not authority. |

## Frontend consumers needing resource capabilities

Primary global projection is `auth/auth.service.ts::toMeResponse`, with independently built module capability helpers and `canCreateObject(roleCodes)`. Frontend must stop inferring action availability from a changed role list when a personal deny can override it. Global entry, record capability, lifecycle disabled reason and sensitive field projection have different meanings.

| Consumer | Existing branch/surface to replace or reconcile |
| --- | --- |
| `shared/ui/app-shell/app-sidebar.tsx`, `app-header.tsx` | Module capability navigation, settings entry, unread badges; menu removal alone is not enforcement. |
| `shared/lib/access.ts` | Duplicated leadership/create/edit/status/frozen helpers; daily-rate roles founder/director differ from backend reusable-rate management leadership+deputy. Do not extend/reuse this narrow helper blindly. |
| `features/dashboard/ui/dashboard-role-router.tsx` | Role-routed dashboard choice; API still needs actual granted dashboard and child module scope. |
| `features/object-create/ui/object-create-dialog.tsx`, `features/object-edit/ui/object-edit-form.tsx`, `app/(app)/objects/[id]/edit/page.tsx` | Create/edit/field role checks, money form fields, target pickers and attachment flows. |
| `app/(app)/one-time-orders/page.tsx`, specification-catalog page, order-create dialog | Creation/catalog role checks and order scope; honor actual grant and restricted composition rule. |
| `features/one-time-order-calendar/ui/one-time-order-calendar.tsx` | Local role/permission calendar controls; source-specific private comments and hidden-order data. |
| `features/one-time-order-inventory/ui/one-time-order-inventory-panel.tsx` | Display-only history; connect allowed scoped issue UI to existing route after lifecycle/idempotency fix, narrow options/capability refresh. |
| `features/object-inventory`, inventory movement/catalog/report features | Separate catalog read/global operations/assigned target issue; source denial invalidates open forms. |
| `features/equipment-scope`, equipment-card/form/list | Global card vs scoped reference and action rights; do not turn scoped presence into global unit access. |
| Employee workspace/calendar, candidate form/registry, task workspace, timesheet grid | Backend section/action capabilities, response fields, separate completion/approval/finance actions; audit all capability consumers, not just explicit role literals. |
| `app/(app)/accountability/page.tsx`, account forms/reports | Self account, administrative review, order payouts and approvals independent; totals keep ledger status distinctions. |
| Shared media entry/preview, global search/recent, notifications panel, chat realtime stores | On revoke refetch/clear stale cached data and action state; new deliveries must already be authorized server-side. |

Explicit role/permission source sweep also finds `entities/user/model/user.types.ts`, `entities/accountability/model/accountability.types.ts` and `shared/auth/auth-client.ts`; these are contract/projection consumers, not authorization enforcement by themselves. Audit response types and capability defaults with B changes. No UI implementation was done by A.

## Background producers and infrastructure exclusions

Delivery must be authorized at queue consumption/dispatch as well as initial recipient selection. Producer sweep found `candidates/candidate-reminder.service.ts`, `candidates/candidates.service.ts`, `employees/employee-birthday-notification.service.ts`, `object-operations/object-operations.service.ts`, `object-operations/object-daily-report-publication.service.ts`, `objects/objects.service.ts`, `objects/object-planning.service.ts` (budget alert and leadership chat publication), `one-time-orders/one-time-orders.service.ts`, `tasks/tasks.service.ts`, `tasks/task-auto-close.service.ts`, `visit-plans/operational-overdue.service.ts`, and `chats/chats.service.ts`. Shared approvals also initiate domain effects/notifications indirectly. Each producer needs current recipient eligibility, parent read and field policy; do not confer the original actor's rights on every recipient. Outbox deduplication is I; visibility/recipient filtering is A. A did not inspect every producer payload field, so those remain an explicit main/E review checklist.

`health/health.controller.ts` is infrastructure health, not a founder-toggle CRM operation. Prisma/Redis/Storage modules, password hashing, authentication rate limiting, response-time interceptor and exception filter are infrastructure/system invariants, not user permissions. `audit/audit.service.ts` has no public standalone controller in this sweep: audit reads are exposed through domain history endpoints; immutable audit writes remain system effects. No SSH/database/storage-secret administration is added to the CRM access window.

## Late concurrent integration snapshot: B/main handoff

While A wrote this inventory, B's new files appeared: `users-access/access-action-catalog.ts`, `types/access-policy.type.ts`, `utils/access-policy.util.ts`, schema/migration and admin DTO work. D also replaced the scoped-order inventory service with a wrapper delegating to `InventoryService.listOneTimeOrderInventory/createOneTimeOrderIssueMovement`. Those changes are other agents' work and have not been verified by A. The early scoped-endpoint finding above describes the previous implementation. The 350-route appendix reflects the syntactic sweep at its generation time; recheck newly introduced access-admin controllers before final closure.

B's implementation uses `AccessScope = own | assigned | selected | all`, `AccessContext` with resource/owner/assignee IDs, invariants and parents, `decideAccess(subject, code, legacyAllowed, context)` and `buildAccessWhere(...)`. Use those actual shared names for adapters; the semantic operation proposals above are not an instruction to introduce competing helpers or duplicate namespaces. Translate `self`/`created` into `own` only with explicit operation-specific owner semantics; `member`/`participant`/`visible` remain resource eligibility/dependency rules, not arbitrary strings passed as scopes.

| Inventory semantic family | B catalog family/code observed | Required reconciliation before declaring connected |
| --- | --- | --- |
| Objects view/core/actions | `objects.access`, `objects.read`, `objects.update`, specific object entries | Maintain separate field/action decisions and matching list filters, not a broad update override. |
| Orders | `one_time_orders.*`, separate `one_time_order_calendar.*` and `specification_catalog.*` | Use these actual namespaces; finance/core/link/deadline/service lines need exact action mapping where bundle entries are insufficient. |
| Task operations | `tasks.read/update/assignees.manage/result.submit/completion.*/confirm/complete_now/return/reopen/cancel/history` | `tasks.create` is global-scoped in catalog; target visibility and membership must remain invariant context; completions/history require coverage. |
| Employees | `employees.view/edit/.../availability.manage/substitutions.manage/attendance.read/documents.edit` | The inspected catalog uses legacy alias `employees.assignments.delete_as_error`, but actual old helper/catalog code is **`employees.assignments.delete_error`**. Correct alias ownership with B; never drop an existing destructive-right restriction. |
| Candidates | `candidates.access/view/manage/create/update/status/archive/restore/assignments.manage/respond/convert_employee` | Add/update list scopes before enabling selected grants; manager eligibility and hard deny stay; conversion also needs Employee create. |
| Equipment | `equipment.read/catalog.*/unit.*/history/assign_object/assign_order/return/move/broken/repair/repair_return/lost/writeoff` | A unit action uses unit resource ID, target scope uses object/order context; own/assigned not listed on these observed selected/all entries. No blind type cast to widen scope. |
| Mats | `mats.access/read/catalog.read/catalog.create/cost.edit/quantity.edit/history` | Catalog/cost history vs object quantity history differ; catalog operation resourceType currently object requires careful selected-ID semantics. |
| Timesheet | `timesheet.access/read/overview/export/attendance.edit/amount.edit/manual_correction/exceptions.create/corrections.read` | Singular namespace; amount edit vs approval/exception authority and past-date independent leadership constraint remain distinct. |
| User calendar | `user_absences.access/read/view_all/create/update/delete/manage/view_private_reasons` | Target resource is User; self event vs foreign event mutations and private reason visibility must be checked separately. |
| Plans | `visit_plans.access/read/manage/visits.manage/reports.manage/history` | Target resource is manager User, not plan ID; manager options/object options/deadlines/entry remove must map and be tested explicitly. |
| Substitutions | `user_substitutions.access/read/create/manage/revoke` | Inspected new admin alias is `user_substitutions.manage`, but legacy service checks **`objects.substitution.manage`**, absent from reconstructed 51. Reconcile alias; source/replacement User scope and selected object IDs must not be conflated. |
| Files/chat/notifications | `files.*`, singular `chat.*`, `notifications.*` | Registration is `integrationStatus: policy_contract` only. Domain file parent checks, chat membership/current receiver filtering, delivery revocation still require real adapters. |

`manageable:false`/`policy_decision_required` entries in the observed catalog explicitly represent unresolved restricted authority, not completed user control. They must remain visible with reasons and closure decisions; they cannot be counted as fulfilled "all rights" merely because registered. Conversely, do not weaken an invariant to make a toggle appear functional. A's row-by-row matrix is the missing-adapter checklist for B/D/main/E, not a blanket recommendation to make every restriction mutable.

Observed catalog scopes are group defaults, so owner/assignee/selected identity must be checked per action. Proposed adapters must supply the correct context and translate deny scopes in queries/counts/aggregates. Do not use arbitrary `all` or empty assignment arrays as a fallback for an unavailable context. `buildAccessWhere` and detail decisions must agree for selected deny and parent deny. Scope claims remain unverified until exercised by actual negative tests.

## Verification contract and open closure ledger

Every operation above needs a trace record containing operation code → old branch/helper/query → resolver call/scope filter → controllers/services/field mapper → UI → search/files/export/notification/realtime consumers → positive/negative tests and actual result. A file listed here is evidence of where to work; it is not a passing result.

| Test obligation | Concrete cases and evidence locations |
| --- | --- |
| Zero-overrides compatibility | Compare legacy vs new decisions across canonical roles, multiple roles, creator without active assignment, assigned vs removed, direct permission, personal deny, expired/revoked substitution. `role-permissions`, `auth-me`, object/task/order/accountability access suites exist. New all-operation baseline comparison not verified. |
| Scope and parent deny | Denied objects cannot leak through creator/assignment/delegation/order link/dashboard/pickers/search/recent/export/files/notifications/realtime. Test selected resource A vs B, module deny with allowed child, stale form after revocation. No complete suite coverage asserted. |
| Two-manager warehouse path | Active assigned open order success; wrong order, completed/cancelled order, removed assignment, revoked right, insufficient stock, two concurrent requests, repeated request key, evidence attach/correction, safe item choices. Existing inventory suites do not establish this new path end-to-end. |
| Founder UI/API | Non-founder direct endpoint denial; accurate effective source/scope; default restore; unsupported code/scope rejected; stale expected version; concurrent preview/save; last active administrator; reason/audit and no audit mutation; open-session capabilities refreshed. New functionality, not verified. |
| Sensitive fields | Contract amount, budget, employee private fields, calendar foreign reasons, order money/payment ownership and recursive audit JSON; same filtering in export/search/files/dashboard/approval payload. Existing object setup/planning/employee/calendar/export suites are starting points, not full deny coverage. |
| Approval/finance | Self/unauthorized resolver denied; correct type only; pending/current version; independently approved historical monetary change; repeat resolve one effect; snapshots unchanged; closure active again; accrual != payout; no global payroll from substitution. Existing approvals/accountability/financial-history/team-compensation suites; new per-operation grant/deny cases needed. |
| Delivery revocation | Keep socket connected; revoke module/action/assignment/membership; publish later event and queued report/budget/candidate/overdue/birthday notifications; no private title/body/entity leakage. Count/list/dismiss and file preview retry/content must agree after revoke. Dispatcher lacks current-policy check in inspected baseline. |
| Operation completeness | Compare route appendix against connected adapter registry and audit remaining role/permission/owner assertions. Every operation must be connected, restricted with explanation, business invariant, or unsupported with reason. A count of catalog entries or `connected:true` flag is not proof. |

Explicit unresolved/unsupported points:

- Actual production 51-row state and per-user grants were not queried. User-provided operational manager facts are context, not fresh runtime evidence.
- Addressed employee payout discrepancy still lacks exact order/screen/date/cycle/source document; existing confirmed payout context means "pending approval" is not a sufficient universal explanation. Keep OQ-144 cash formula unchanged.
- OQ-141 broad Employee attendance/object history visibility and OQ-142 conflict blocking vs warning remain business questions. No new business rule was invented.
- OQ-148 coefficient formula and missing actual-cost sources remain unknown; unknown values cannot be fabricated as zero.
- Order review rights, specification reopen circle, photo exception permission override, task-result unused permission and read-only equipment attachment mismatch require explicit reconciliation/testing.
- Inventory/equipment return approval types are documented but absent from inspected type resolver dispatch; legacy mat mutation endpoints are retired. Unsupported operations must not appear as working controls.
- Profile/account management beyond login/refresh/logout/me and purpose-specific user options is not present in inspected controllers; password reset, user lifecycle administration or role editing require actual implementation before being exposed.
- Cross-file source sweep and route enumeration are broad coverage evidence, not exhaustive semantic proof. Financial field mapping, every notification producer recipient query, every task lifecycle detail, calendar roster edge cases and multi-parent file denial still require owner review and independent tests.
- No automated tests or live checks were run, so none of the listed obligations is marked passed. Finish requires E/Terra verification and integration results from actual adapter owners.

### Open product choice: approval read authority — 2026-11-07 (B)

Status: **awaiting the user's answer**. Main sent an asynchronous question; neither option is approved. This is a bounded product choice, not authorization to expand runtime semantics or add a new architecture.

- **Separate read grant:** permit an explicit `approvals.read` grant for selected/all requests beyond the former requester/type-resolver read circle. This grants no resolve authority and must retain source/parent denies and sensitive-field restrictions.
- **Current read circle only:** keep reading within the former requester/type-resolver circle. In this option, a selected/all read allow cannot widen that circle; the UI/API must explain that limitation rather than advertise an effective widening toggle.

Current implementation: `ApprovalsService.buildVisibilityWhere` passes the legacy requester/type-resolver predicate as both `legacyWhere` and `invariantWhere`. Consequently, a new read grant cannot expand beyond that predicate. **Until the user answers, retain `invariantWhere: legacy`; semantic expansion and local runtime edits are frozen.** This conservative implementation is not evidence that the read circle is an approved immutable business invariant.

Contract distinction: [rollout §3.6–7](access-control-rollout-2026-11-06.md#3-безопасность-и-совместимость), [access matrix §13](../architecture/access-matrix.md#13-approval-mapping), and [product contract §14](product-contract.md#14-module-boundary-mapping-for-approvals) preserve resolver authority and independent approval. No explicit clause was found there making the same resolver circle an immutable limit on a separately granted read-only capability. Resolver constraints remain unchanged under either option.

After the choice, `approval_request` notification positive visibility must agree with the approval endpoint's final read predicate and source checks before pagination/count/delivery; notification receipt or `decideAccess(..., true)` alone is not proof of source visibility. This remains open, not connected or verified. Production remains read-only: no deployment, migration, grant or data mutation is authorized.

## Controller route evidence

### A secondary backend adapter status after explicit write authorization

This section records code changes, not passing authorization tests. All nine modules received direct subject-aware policy integration. No module is certified completely connected. B owns the shared catalog/resolver/schema; main owns common resource context and cross-channel delivery; D owns the first five domain modules. Following explicit ownership expansion, A also owns and modified `object-delegation.context.ts`. A did not change global ALS aliases, role/identity assignment, seed, migrations, tests, frontend or other owners' files. New helpers live inside the owned modules and take an explicit subject.

| Module | Code connected in A's pass | Remaining leaf/scope/verification work; do not claim complete |
| --- | --- | --- |
| Tasks | `task-policy.util.ts`: registry/detail filters before pagination/count, object/order parent-deny translation; create entry; interactive transaction rechecks for read and completion/assignee/lifecycle actions; creator/lifecycle decisions use operation codes; task history; action capabilities keep terminal/own-assignment invariants outside grants. | Completion-list permission is still read-derived because B has no separate completion-history action; `tasks.status` separate deny/allow and composite allowedStatusTransitions need endpoint-to-leaf review. Shared approval/system auto-close effects are not redefined here. Verify every assigned/selected grant against detail/query/capabilities and target metadata. |
| Employees | `employee-policy.util.ts`: selected/all Employee read filter; raw SQL registry allowed IDs applied before order/limit/count; detail/attendance guards; position references scoped before LIMIT; create/edit/archive/restore/delete/assignment assertions; lifecycle capabilities; document-write check; schedule update/delete helpers and availability/substitution create checks; explicit object-deny filters on current staffing/history/substitutions/attendance/reference queries. | Employee registry first materializes authorized IDs: correct scope intent, but large-data performance must be measured. Destructive blocker metadata and error-history capabilities need exact audit; target deny on every unassign/error-history variant and all nested substitute Employee references requires review. Global auth capabilities are main/B integration. No new private Employee field catalog was invented; OQ-141/OQ-142 unchanged. |
| Candidates | Existing query helper now explicitly accepts AccessSubject and scope filters; list/count/detail; create/update/status/archive/restore/assignment/convert/respond assertions; active assignment/SLA retained; conversion checks Employee create policy; action capabilities; nested object references redacted under explicit object denies. | General `candidates.manage` bundle vs separately granted leaf operations and HR feedback authorization must be reconciled; candidate manager picker currently retains legacy eligibility rather than filtering the target User's new rules. Background reminder/recipient checks are main-owned integration. New selected/own reads and every deny require DB tests. |
| Equipment | `equipment-policy.util.ts`: unit/query scope and source/destination parent-deny filters; registry before order; detail/history; history movement query filters all historical from/to targets; catalog entry and scoped unit counts; catalog/unit create and deletion actions; generic movement dispatch and destination denies; per-unit action capabilities; object/order scoped lists filter policy; scoped writes recheck assignment, readonly issue destination and policy in transaction. | Catalog-item IDs and unit IDs must not be conflated by selected scopes: catalog create/delete scope semantics need B agreement. `equipment.move` has no native movement enum and remains a compound-workflow mapping. New catalog-read-only grants, catalog counts, scoped/global differences, history visibility and all lifecycle transitions need DB tests. File/evidence writes remain main-owned. |
| Mats | Aggregate registry scoped before page/count; object read/quantity action decisions with explicit object parent; catalog read/create/cost decisions; history guards and capabilities; historical versions/cost snapshots unchanged. | Selected cost/catalog operations currently have object resource metadata in B, not size IDs: unsupported ID semantics must be fixed rather than exposed as working selected controls. Cost history has global checks; own/assigned object-history context and legacy retired endpoints need endpoint review. Legacy mutations stay retired. |
| Timesheets | Object eligibility query and parent deny reused by detail/overview/references; export and correction-history guards; overview/export action filtering; money edit authorization separate from attendance/read; assigned/selected money query check, explicit manual-correction deny; exception request gate; past-date approval routing unchanged. | Overview/global manual-correction/export booleans still need exact scope-aware projection; reference endpoints currently derive read rather than independent reference codes; Employee privacy/deny intersects are not complete. Verify assigned/own amount capabilities agree with server query; shared resolution is B/main authority. No historical recalculation or approval broadening. |
| User absences | Effective User ID read scope enters raw SQL before ordered output; self vs foreign read; per-target private-reason projection; create/update/delete policy with separate foreign manage dependency; owner-only default remains; users options filtered by effective read scope. | Some global `canViewAll`/privacy booleans retain legacy representation and need truthful selected-scope UI projection. Leadership aggregate helper methods are still service-internal legacy consumers; main/dashboard must filter under recipient policy. No standalone detail operation exists. |
| Visit plans | Target manager User context; read/manage/visits/report/history decisions; options filtered by management scope; target recheck inside lock; per-target capabilities; nested object entries subtract object denies. | Personal selected grants need preflight/target tests; deadline/add/remove entries share manage because separate catalog leaf entries are absent. Audit history may contain prior denied object/client fields; needs explicit redaction decision. Object options/selectedId and managers' target scope require full negative tests. |
| User substitutions | Explicit subject policy for list/count before paging and revoke; selected grants require every record object to be selected, selected denies match any; explicit object parent denies exclude affected records; create remains own principal or admin; runtime grant resolution reloads principal/replacement grants/rules and subtracts object/action denies without changing shared context type. | Options/create source validation still partly uses legacy role scope; selected administration resource semantics need B agreement. Existing `operate` delegation action is coarse: per-leaf source restrictions cannot be represented completely without a coordinated context/consumer change; not declared solved. Sensitive global rights still not inherited. No blanket substitution-role grant added. |

Final lightweight verification of A's current code snapshot: backend `typecheck` exited 0; targeted ESLint on all 15 owned modified/new TypeScript files exited 0; `git diff --check` showed no whitespace errors in owned modules. Document validation confirmed 51 unique sequential legacy rows, 350 route rows, 37 controller file groups and no trailing whitespace. A did not execute integration/unit/DB tests. Main identified shared `buildAccessWhere` SQL truth handling around nested empty OR/NOT; B owns the core correction and E owns DB regression checks. **Do not interpret typecheck/lint as a passing policy/SQL result**, or mark any row connected solely because a catalog entry exists. Local explicit false filters use `id: { in: [] }` rather than empty OR; all effective query semantics still depend on the shared core correction and E's evidence. Whole-system authorization, global capability projection and unresolved leaf/scope rows above remain open.

### A stable-package handoff and superseding updates, 2026-11-06

The module table above records the preceding checkpoint. These updates supersede its stale entries; no module is declared complete. **2026-11-07 freeze confirmation:** the bounded utility extraction is finished; A's source is frozen until main reports test/live stability and gives feedback. Main reports using the pure utility for background notification visibility. A is not starting new adapter extensions or checks. No heavy checks, DB tests, production access or deployments were performed by A.

- Candidates: scoped manage-bundle fallback and explicit bundle deny now feed management leaves. Feedback uses real active assignments. Mutation-time manager eligibility checks candidate view/module denies against the actual candidate, including prospective assignment. Picker excludes all-scope denies, but candidate-specific picker context remains open. Card DTO now matches emitted `canEdit`, `canChangeStatus`, `canManageAssignments`.
- Tasks: status endpoint assertion is connected; the legacy endpoint has no actual status transitions, so `allowedStatusTransitions` stays empty. Separate completion-list/field read policy remains open pending catalog agreement (`tasks.completions.read` requested). Remaining consumers: `listTaskCompletions`, `mapTask` resultText/currentCompletion/completionHistoryCount, history payloads and completion attachment discovery must agree on the field-read policy. Existing lifecycle/own-active-assignment invariants must remain independent.
- Equipment: deletion eligibility now evaluates the unit-delete policy alongside unchanged lifecycle blockers; aggregate movement capability includes repair-return/lost/move leaves. Catalog-item identity versus unit identity, compound movement enforcement and exact scoped history caps remain open.
- Mats: aggregate and live legacy registry share `matObjectPolicyWhere`, translating both delegation snapshots' leaf/parent denies before pagination/count without removing the actor's independent branch. Legacy detail/history have actual leaf/context guards. Quantity history now carries real owner/assignment context. Legacy mutations remain retired. Size cost-history action/resource semantics remain open; catalog/cost controls currently expose global scopes.
- Visit plans: actual scoped `visit_plans.manage` feeds visits/report leaves and read fallback; explicit manage deny remains effective. History/reference redaction and distinct manage subactions remain open.
- Absences: global visibility/privacy caps now evaluate policy, but partial selected-scope presentation and row/options mutation caps remain open. Leadership helpers accept an optional subject and filter SQL before COUNT/LIMIT; dashboard owners must pass the current actor.
- Employees: distinct status/reference/options codes remain requested: `employees.status`, `employees.references.positions`, `employees.references.objects`, `employees.assignments.options`. Matching service assertions/query scopes and `canManageStatus` still require reconciliation; document-edit capability and any approved field-read controls need exact projection. Audit target denies on unassign/delete-as-error and nested substitution references; archive blockers must continue counting all actual assignments, not only visible ones. Registry materializes allowed Employee IDs before SQL pagination/count; production-scale performance is unmeasured. No new private-field policy is implicitly approved by this inventory.
- Timesheets: overview/global manual-correction/export capabilities need exact selected/assigned target projection; reference consumers still derive read access rather than an independent reference action. Single-row assigned context and Employee-deny/field intersections require audit. Read, amount-edit, historical correction and independent approval remain distinct; no historical recalculation or approval broadening is authorized.
- Substitutions: source/replacement snapshots and actual object context now travel through the coordinated delegation API below. Source-policy options/create validation and selected-admin semantics remain open.

Published backward-compatible contracts:

- `ObjectDelegationGrant` adds optional `principalSubject`, `replacementSubject`, `objectPolicyContext`. Snapshots contain fresh real roles, direct/role permission union and personal rules; no identity substitution.
- `hasDelegatedObjectAction(actorId, objectId, coarseAction, recordUsage = true, policyActionCode?, policyContext?)` and `delegatedObjectIds(actorId, coarseAction = 'view', policyActionCode?, policyContext?)` preserve coarse prerequisites and subtract both participants' leaf/ancestor denies. Unit/task selected scopes require their real resource ID, never the object ID. Missing context with scoped leaf deny fails closed.
- `hasDelegatedTaskAction(actorId, task, kind, recordUsage = true, policyActionCode?, policyContext?)` derives actual task owner/assignees when available. `delegatedTaskScopes(actorId, policyActionCode?)` and `delegatedObjectScopes(actorId, coarseAction = 'view')` expose snapshots for query adapters, which must translate scoped denies before pagination/count.
- `delegationAllowsPolicyAction(grant, policyActionCode?, policyContext?)` subtracts denies/inactive users only; it never manufactures entitlements.
- `resolveObjectDelegationGrants(prisma: Pick<PrismaService, 'userSubstitution'>, actorUserId: string): Promise<ObjectDelegationGrant[]>` is exported from `apps/backend/src/modules/user-substitutions/resolve-object-delegation-grants.util.ts`. It is the extracted single grant algorithm: no audit, DI, context installation or grant-algorithm duplication. `UserSubstitutionsService.resolveGrants` delegates unchanged. Background callers install their own bounded visibility context with returned fresh grants.
- `countTodayForLeadership(date, subject?)`, `listUpcomingForLeadership(date, limit = 5, subject?)`: pass the current actor to scope aggregation. Omitted subject preserves the existing internal contract.
- Bounded post-freeze correction authorized on 2026-11-07: `tasks/utils/task-policy.util.ts` exports `taskVisibilityWhere(subject, legacyTaskWhere, actionCode = 'tasks.read')`; `TasksService` consumes it. Search/notification owners can pass their existing `buildTaskAccessWhere(...)` predicate. It applies task policy and intersects `{ OR: [{ oneTimeOrderId: null }, { oneTimeOrder: orderReadWhere }] }` **after** the task-grant union, so a task allow cannot bypass positive order visibility. `orderReadWhere` uses the existing order helper with the actual subject; no additional `canAccessOneTimeOrders` role gate is invented. Existing independent own/assigned/explicitly visible object-linked task paths remain: no positive object-read requirement is added, while explicit object parent denies remain effective. Add DB cases for task creator/assignee/task-selected allow with an unreadable order, actual positive order allow, and an independently visible object-linked task without object-role visibility. This correction is not a claim that completion-field or other open task gaps are closed.

DB regressions requested from main/E: source-only leaf deny; replacement-only leaf deny; source/replacement object parent deny; selected/own/assigned task/unit/object scopes; query/count/detail/capability agreement; inactive/expired/revoked snapshots; candidate manager selected deny blocks assignment within the transaction. Crucially, source deny removes only delegated access, not an independently authorized actor branch. Shared nested-empty SQL truth fixes remain B/E verification, not an A passing-policy claim.

Final A package validation, including the extracted utility and synchronized Candidate DTO: backend `pnpm --filter backend exec tsc -p tsconfig.json --noEmit --incremental false` exited 0. Targeted ESLint on the eight files in the preceding package and both substitution extraction files exited 0; owned-module `git diff --check` exited 0. These are recorded completed runs, not fresh checks during the freeze. A has not run or certified main's four DB suites or live verification. Type/lint success is not DB/security-test success. The nine modules' remaining gaps above stay open until actual consumers and negative evidence are delivered; READY-FOR-DB applies only to this frozen package.

### Authorized candidates coupling + visit-plan read export, 2026-11-07

This bounded follow-up supersedes the earlier freeze only for the explicitly requested files. No new task status business operation was implemented. `tasks.status` remains the existing compatibility no-op; B owns its retired/unsupported standalone catalog classification. Dedicated task lifecycle operations stay canonical. Timesheet manual-correction semantics, equipment catalog identity and the other frozen adapters were not changed in this package.

Candidates consumers now share `candidateActionAllowed(subject, actionCode, context)` and the matching `buildCandidateAccessWhere(subject, actionCode)` composition. The exact current catalog codes are used; none were added. Management leaves inherit effective scoped `candidates.manage`, retain its explicit deny as a parent restriction, and require independent candidate read visibility. Direct responder authority is separated from the legacy manage bundle: denying manage removes unassigned HR feedback, but does not erase independently authorized feedback on the actor's active assignment. `candidates.denied` and module/read denies continue to win. Queries use each action's actual legacy default, not view permission as a management default. Default registry includes scoped managed candidates in addition to the legacy own-assignment branch; explicit mine filtering stays mine.

The create/update/status/assignment/convert/respond/archive/restore consumers use those existing leaf decisions. Record mutations recheck the scope through the transaction client after locking; initial manager assignments and reopening with supplied assignments also require the existing `candidates.assignments.manage` leaf. Automatic status/SLA/assignment effects of canonical feedback/closing/conversion are not exposed as new standalone operations. Archived edit/status reject consistently with the existing closed capabilities. Feedback ownership/SLA, optimistic versions, manager eligibility, required managers on reopening, atomic Employee creation and separate Employee-create authorization remain in force. Card edit/status/assignment/archive/restore/convert/respond capabilities now use the same entitlement helper as the query guard.

Published visit-plan query export: `apps/backend/src/modules/visit-plans/visit-plan-access.util.ts::visitPlanReadUserWhere(subject): Prisma.UserWhereInput`. Notification source consumer: `{ manager: visitPlanReadUserWhere(subject) }` on ManagerVisitPlan. It preserves the previous positive read rule, owner OR effective manage OR leadership, followed by read/module policy on manager User identity. `visitPlanManageUserWhere(subject)` is shared with the manager picker. Service `assertRead` now uses the exported read query, and all three call sites await it. No target active/manager-role requirement was added. No assigned-user fact exists in the original read context: assigned matches no targets, represented by `id: { in: [] }`, rather than inventing role-based assignment. B should reconcile the advertised scope metadata. A read check against a nonexistent manager User now fails closed instead of treating a nonexistent day plan as a readable target; existing plan targets already have the foreign key.

Requested main/E regressions for this bounded package: bundle allow selected A does not authorize B; bundle deny blocks a leaf grant where applicable; legacy manage-only feedback is removed by manage-deny; independent direct respond plus own active assignment survives manage-deny; read/module deny defeats all leaves; query and capability decisions agree for own/assigned/selected; changed assignment scopes are checked after lock; create/reopen cannot bypass assignment-manage deny; archived edit/status stay closed. Visit plans: owner and leadership read survive manage-only deny, read/module deny wins, selected IDs mean User rather than plan, and assigned does not invent an assignment relationship. No DB results are claimed by A.

Candidate-only tsc/lint passed before the visit helper; the combined bounded package also passed backend `tsc --noEmit --incremental false`, four-file targeted ESLint and scoped `git diff --check`. Remaining contextual candidate picker, private-field policies, visit-plan history/reference redaction and all other previously listed rollout gaps are not declared complete.

The appendix below is generated from controller decorators in the inspected source, excluding commented-out decorators. It enumerates discovered HTTP surfaces, including multiple controller classes in one file. It is a route checklist, not evidence that authorization is already connected. Module sections above define the proposed mapping; unusual/retired routes must be classified explicitly during adapter review. Websocket upgrade and background deliveries are inventoried separately above.


Source sweep found **350 HTTP method decorators in 37 controller files**. Counts exclude the websocket upgrade and non-controller background jobs. Prefix is relative to the application's API base. This syntactic count is not a count of independent rights.
...

### apps/backend/src/modules/accountability/accountability.controller.ts

| Source line | Method / route |
| --- | --- |
| 46 | `GET /accountability/me` |
| 53 | `GET /accountability/accounts` |
| 60 | `GET /accountability/accounts/:userId` |
| 68 | `GET /accountability/orders/:orderId` |
| 79 | `GET /accountability/reference/users` |
| 86 | `POST /accountability/accounts/:userId/fundings` |
| 95 | `POST /accountability/me/fundings/external` |
| 103 | `POST /accountability/fundings/:fundingId/reverse` |
| 112 | `POST /accountability/me/expenses` |
| 120 | `PATCH /accountability/me/expenses/:expenseId` |
| 129 | `POST /accountability/me/expenses/:expenseId/submit` |
| 138 | `POST /accountability/expenses/:expenseId/approve` |
| 147 | `POST /accountability/expenses/:expenseId/reject` |
| 157 | `POST /accountability/me/closures/request` |
| 164 | `POST /accountability/closures/:closureId/approve` |
| 173 | `POST /accountability/closures/:closureId/reject` |

### apps/backend/src/modules/approvals/approvals.controller.ts

| Source line | Method / route |
| --- | --- |
| 40 | `GET /approvals` |
| 48 | `GET /approvals/:id` |
| 56 | `POST /approvals/:id/approve` |
| 66 | `POST /approvals/:id/reject` |
| 76 | `POST /approvals/:id/cancel` |

### apps/backend/src/modules/auth/auth.controller.ts

| Source line | Method / route |
| --- | --- |
| 38 | `POST /auth/login` |
| 57 | `POST /auth/refresh` |
| 89 | `POST /auth/logout` |
| 106 | `GET /auth/me` |

### apps/backend/src/modules/candidates/candidates.controller.ts

| Source line | Method / route |
| --- | --- |
| 18 | `GET /candidates` |
| 21 | `GET /candidates/references/managers` |
| 24 | `GET /candidates/:id` |
| 27 | `POST /candidates` |
| 30 | `PATCH /candidates/:id` |
| 33 | `POST /candidates/:id/status` |
| 36 | `POST /candidates/:id/archive` |
| 39 | `POST /candidates/:id/restore` |
| 42 | `POST /candidates/:id/assignments` |
| 45 | `POST /candidates/:id/responses` |
| 48 | `POST /candidates/:id/employee` |

### apps/backend/src/modules/chats/chats.controller.ts

| Source line | Method / route |
| --- | --- |
| 50 | `GET /chats/search` |
| 60 | `GET /chats/rooms` |
| 68 | `GET /chats/rooms/code/:code` |
| 76 | `POST /chats/rooms` |
| 84 | `POST /chats/rooms/direct` |
| 92 | `POST /chats/rooms/group` |
| 100 | `PATCH /chats/rooms/:roomId` |
| 109 | `POST /chats/rooms/:roomId/participants` |
| 118 | `DELETE /chats/rooms/:roomId/participants/:userId` |
| 127 | `POST /chats/rooms/:roomId/hide` |
| 135 | `POST /chats/rooms/:roomId/unhide` |
| 143 | `POST /chats/rooms/:roomId/leave` |
| 151 | `POST /chats/rooms/:roomId/close` |
| 160 | `GET /chats/rooms/:roomId/participants` |
| 168 | `GET /chats/rooms/:roomId/messages` |
| 178 | `GET /chats/rooms/:roomId/messages/window` |
| 193 | `GET /chats/rooms/:roomId/messages/unread-window` |
| 201 | `GET /chats/messages/:messageId` |
| 209 | `POST /chats/rooms/:roomId/messages` |
| 226 | `PATCH /chats/messages/:messageId` |
| 235 | `POST /chats/messages/:messageId/delete` |
| 243 | `POST /chats/messages/:messageId/forward` |
| 252 | `POST /chats/messages/:messageId/reactions/heart` |
| 260 | `POST /chats/rooms/:roomId/read` |

### apps/backend/src/modules/counterparties/counterparties.controller.ts

| Source line | Method / route |
| --- | --- |
| 43 | `GET /counterparties` |
| 51 | `GET /counterparties/references` |
| 59 | `GET /counterparties/:id` |
| 64 | `GET /counterparties/:id/history` |
| 69 | `GET /counterparties/:id/history-page` |
| 78 | `GET /counterparties/:id/inventory-movements` |
| 87 | `POST /counterparties` |
| 95 | `PATCH /counterparties/:id` |
| 104 | `POST /counterparties/:id/archive` |
| 109 | `POST /counterparties/:id/restore` |
| 114 | `POST /counterparties/:id/objects/:objectId` |
| 123 | `DELETE /counterparties/:id/objects/:objectId` |
| 132 | `POST /counterparties/:id/master-object/:objectId` |
| 141 | `DELETE /counterparties/:id/master-object` |

### apps/backend/src/modules/dashboard/dashboard.controller.ts

| Source line | Method / route |
| --- | --- |
| 54 | `GET /dashboard/leadership` |
| 76 | `GET /dashboard/manager` |
| 83 | `GET /dashboard/hr` |
| 89 | `GET /dashboard/operation-manager` |

### apps/backend/src/modules/employees/employees.controller.ts

| Source line | Method / route |
| --- | --- |
| 65 | `GET /employees` |
| 73 | `GET /employees/object-candidates` |
| 80 | `GET /employees/references/positions` |
| 88 | `GET /employees/references/objects` |
| 96 | `GET /employees/:id` |
| 104 | `GET /employees/:id/attendance` |
| 113 | `POST /employees` |
| 121 | `PATCH /employees/:id` |
| 130 | `PATCH /employees/:id/status` |
| 139 | `POST /employees/:id/archive` |
| 148 | `POST /employees/:id/restore` |
| 157 | `POST /employees/:id/delete-permanently` |
| 170 | `POST /employees/:id/availability` |
| 179 | `POST /employees/:id/substitutions` |
| 188 | `PATCH /employees/:id/availability/:windowId` |
| 199 | `DELETE /employees/:id/availability/:windowId` |
| 209 | `PATCH /employees/:id/substitutions/:substitutionId` |
| 220 | `POST /employees/:id/object-assignments` |
| 229 | `DELETE /employees/:id/object-assignments/:objectId` |
| 242 | `POST /employees/:id/object-assignment-history/:historyId/delete-as-error` |

### apps/backend/src/modules/equipment/equipment.controller.ts

| Source line | Method / route |
| --- | --- |
| 40 | `GET /equipment/catalog` |
| 47 | `POST /equipment/catalog` |
| 55 | `DELETE /equipment/catalog/:id` |
| 63 | `GET /equipment/units` |
| 71 | `POST /equipment/units` |
| 79 | `GET /equipment/units/:id` |
| 87 | `DELETE /equipment/units/:id` |
| 95 | `GET /equipment/units/:id/movements` |
| 103 | `POST /equipment/units/:id/movements` |

### apps/backend/src/modules/equipment/scoped-equipment.controller.ts

| Source line | Method / route |
| --- | --- |
| 25 | `POST /equipment/scoped/units/:unitId/objects/:objectId/assign` |
| 40 | `POST /equipment/scoped/units/:unitId/one-time-orders/:orderId/assign` |
| 55 | `POST /equipment/scoped/units/:unitId/return` |

### apps/backend/src/modules/files/files.controller.ts

| Source line | Method / route |
| --- | --- |
| 60 | `GET /files/entity/:entityType/:entityId` |
| 73 | `GET /files/:id/content` |
| 91 | `GET /files/:id/view` |
| 99 | `GET /files/:id/thumbnail` |
| 109 | `GET /files/:id/preview/content` |
| 120 | `POST /files/:id/preview/retry` |
| 128 | `GET /files/:id` |
| 136 | `POST /files/upload` |

### apps/backend/src/modules/health/health.controller.ts

| Source line | Method / route |
| --- | --- |
| 23 | `GET /health` |

### apps/backend/src/modules/inventory/inventory.controller.ts

| Source line | Method / route |
| --- | --- |
| 47 | `POST /inventory/movements/:id/correct` |
| 52 | `GET /inventory/items` |
| 60 | `GET /inventory/items/:id` |
| 68 | `POST /inventory/items` |
| 76 | `PATCH /inventory/items/:id` |
| 85 | `DELETE /inventory/items/:id` |
| 93 | `POST /inventory/items/:id/restore` |
| 102 | `GET /inventory/movements` |
| 111 | `GET /inventory/reports/summary` |
| 119 | `POST /inventory/movements` |
| 127 | `POST /inventory/movements/:id/resolve-missing-photo-approval` |
| 136 | `GET /inventory/reference/objects` |
| 143 | `GET /inventory/reference/one-time-orders` |

### apps/backend/src/modules/inventory/scoped-one-time-inventory.controller.ts

| Source line | Method / route |
| --- | --- |
| 28 | `GET /one-time-orders/:orderId/inventory` |
| 36 | `POST /one-time-orders/:orderId/inventory/issue` |

### apps/backend/src/modules/notifications/notifications.controller.ts

| Source line | Method / route |
| --- | --- |
| 15 | `GET /notifications` |
| 20 | `GET /notifications/unread-count` |
| 25 | `POST /notifications/read-all` |
| 30 | `POST /notifications/:id/read` |
| 35 | `POST /notifications/:id/dismiss` |

### apps/backend/src/modules/object-operations/object-operations.controller.ts

| Source line | Method / route |
| --- | --- |
| 71 | `GET /objects/:id/arrival-photo/today` |
| 79 | `POST /objects/:id/arrival-photo` |
| 92 | `GET /objects/:id/daily-report/today` |
| 100 | `GET /objects/:id/daily-reports` |
| 105 | `POST /objects/:id/daily-report/today/submit` |
| 110 | `PUT /objects/:id/daily-report/today` |
| 123 | `POST /objects/:id/daily-reports/:reportId/attachments` |
| 136 | `PATCH /objects/:id/daily-reports/:reportId/attachments` |
| 146 | `GET /objects/:id/comments` |
| 154 | `POST /objects/:id/comments` |
| 163 | `GET /objects/:id/feed` |
| 172 | `GET /objects/:id/linked-one-time-orders` |
| 180 | `GET /objects/:id/inventory` |
| 188 | `POST /objects/:id/inventory/issue` |
| 201 | `GET /objects/:id/equipment` |
| 209 | `GET /objects/:id/employees` |
| 217 | `GET /objects/:id/employee-directory` |
| 230 | `POST /objects/:id/substitutions` |
| 235 | `POST /objects/:id/employees` |
| 248 | `DELETE /objects/:id/employees/:employeeId` |
| 261 | `PUT /objects/:id/employees/:employeeId/rate-policy` |
| 276 | `GET /objects/:id/compensation-rates` |
| 284 | `PUT /objects/:id/compensation` |
| 293 | `POST /objects/:id/compensation-rates` |
| 302 | `PUT /objects/:id/compensation-rates/:rateId` |
| 312 | `GET /objects/:id/attendance/today` |
| 329 | `POST /objects/:id/attendance` |

### apps/backend/src/modules/object-scheduling/object-compensation.controller.ts

| Source line | Method / route |
| --- | --- |
| 13 | `GET /objects/:objectId/scheduling/compensation` |
| 14 | `POST /objects/:objectId/scheduling/compensation/versions` |
| 15 | `POST /objects/:objectId/scheduling/compensation/versions/:id/cancel` |
| 16 | `POST /objects/:objectId/scheduling/compensation/team-funds` |
| 17 | `POST /objects/:objectId/scheduling/compensation/adjustments` |
| 18 | `POST /objects/:objectId/scheduling/compensation/adjustments/:id/correct` |
| 19 | `GET /objects/:objectId/scheduling/compensation/explanation` |

### apps/backend/src/modules/object-scheduling/object-scheduling.controller.ts

| Source line | Method / route |
| --- | --- |
| 12 | `GET /objects/:objectId/scheduling/positions` |
| 13 | `GET /objects/:objectId/scheduling/positions/:id` |
| 14 | `POST /objects/:objectId/scheduling/positions` |
| 15 | `PUT /objects/:objectId/scheduling/positions/:id` |
| 16 | `DELETE /objects/:objectId/scheduling/positions/:id` |
| 17 | `POST /objects/:objectId/scheduling/preview` |
| 18 | `GET /objects/:objectId/scheduling/employees` |
| 19 | `GET /objects/:objectId/scheduling/contours` |
| 20 | `POST /objects/:objectId/scheduling/contours` |
| 21 | `PATCH /objects/:objectId/scheduling/contours/:id` |
| 22 | `GET /objects/:objectId/scheduling/attendance` |
| 23 | `POST /objects/:objectId/scheduling/attendance/confirm` |
| 24 | `POST /objects/:objectId/scheduling/attendance/:id/cancel` |
| 31 | `POST /object-scheduling/preview` |

### apps/backend/src/modules/objects/object-planning.controller.ts

| Source line | Method / route |
| --- | --- |
| 26 | `GET /objects/:id/contacts` |
| 30 | `POST /objects/:id/contacts` |
| 38 | `PATCH /objects/:id/contacts/:contactId` |
| 47 | `DELETE /objects/:id/contacts/:contactId` |
| 56 | `GET /objects/:id/planning` |
| 60 | `PATCH /objects/:id/planning` |

### apps/backend/src/modules/objects/object-setup.controller.ts

| Source line | Method / route |
| --- | --- |
| 13 | `GET /objects/:id/setup` |
| 18 | `PATCH /objects/:id/setup` |

### apps/backend/src/modules/objects/objects.controller.ts

| Source line | Method / route |
| --- | --- |
| 49 | `GET /objects` |
| 57 | `GET /objects/registry-signals` |
| 68 | `GET /objects/:id` |
| 76 | `GET /objects/:id/audit` |
| 84 | `POST /objects` |
| 92 | `PATCH /objects/:id` |
| 101 | `PATCH /objects/:id/status` |
| 110 | `POST /objects/:id/responsibles` |
| 119 | `DELETE /objects/:id/responsibles/:userId` |
| 128 | `POST /objects/:id/managers` |
| 137 | `DELETE /objects/:id/managers/:userId` |

### apps/backend/src/modules/one-time-orders/one-time-order-attention.controller.ts

| Source line | Method / route |
| --- | --- |
| 22 | `GET /one-time-orders/attention` |

### apps/backend/src/modules/one-time-orders/one-time-order-operations.controller.ts

| Source line | Method / route |
| --- | --- |
| 26 | `GET /one-time-orders/:orderId/escorts` |
| 35 | `PUT /one-time-orders/:orderId/escorts` |
| 44 | `GET /one-time-orders/:orderId/service-lines` |
| 52 | `PUT /one-time-orders/:orderId/service-lines` |
| 61 | `GET /one-time-orders/:orderId/deadline` |
| 69 | `PUT /one-time-orders/:orderId/deadline` |

### apps/backend/src/modules/one-time-orders/one-time-order-specification-catalog.controller.ts

| Source line | Method / route |
| --- | --- |
| 36 | `GET /one-time-orders/specification-catalog` |
| 41 | `POST /one-time-orders/specification-catalog` |
| 49 | `PATCH /one-time-orders/specification-catalog/:id` |
| 58 | `DELETE /one-time-orders/specification-catalog/:id` |
| 63 | `GET /one-time-orders/specification-templates` |
| 68 | `POST /one-time-orders/specification-templates` |
| 76 | `PATCH /one-time-orders/specification-templates/:id` |
| 85 | `DELETE /one-time-orders/specification-templates/:id` |

### apps/backend/src/modules/one-time-orders/one-time-order-workforce-directory.controller.ts

| Source line | Method / route |
| --- | --- |
| 25 | `GET /one-time-orders/:orderId/workforce/employee-directory` |

### apps/backend/src/modules/one-time-orders/one-time-order-workforce.controller.ts

| Source line | Method / route |
| --- | --- |
| 50 | `GET /one-time-orders/:orderId/workforce/employees` |
| 58 | `POST /one-time-orders/:orderId/workforce/employees` |
| 67 | `PATCH /one-time-orders/:orderId/workforce/employees/:employeeId/payment` |
| 82 | `DELETE /one-time-orders/:orderId/workforce/employees/:employeeId` |
| 95 | `GET /one-time-orders/:orderId/workforce/attendance/today` |
| 104 | `GET /one-time-orders/:orderId/workforce/attendance/coverage` |
| 112 | `POST /one-time-orders/:orderId/workforce/attendance/today` |
| 127 | `GET /one-time-orders/:orderId/workforce/timesheet` |
| 141 | `GET /one-time-orders/:orderId/workforce/timesheet/export.xlsx` |

### apps/backend/src/modules/one-time-orders/one-time-orders.controller.ts

| Source line | Method / route |
| --- | --- |
| 93 | `GET /one-time-orders/calendar/export.xlsx` |
| 117 | `GET /one-time-orders/calendar` |
| 125 | `GET /one-time-orders/calendar/managers` |
| 133 | `POST /one-time-orders/calendar/check-conflicts` |
| 141 | `POST /one-time-orders/calendar/availability-requests` |
| 149 | `GET /one-time-orders/calendar/availability-requests/me` |
| 156 | `POST /one-time-orders/calendar/availability/direct` |
| 164 | `POST /one-time-orders/calendar/availability/:id/approve` |
| 177 | `POST /one-time-orders/calendar/availability/:id/reject` |
| 190 | `POST /one-time-orders/calendar/availability/:id/cancel` |
| 198 | `PATCH /one-time-orders/calendar/availability/:id` |
| 211 | `GET /one-time-orders` |
| 219 | `GET /one-time-orders/reviews` |
| 227 | `GET /one-time-orders/references/managers` |
| 235 | `GET /one-time-orders/references/objects` |
| 243 | `GET /one-time-orders/:id` |
| 251 | `GET /one-time-orders/:id/completions` |
| 259 | `POST /one-time-orders/:id/complete` |
| 268 | `POST /one-time-orders/:id/reopen` |
| 276 | `POST /one-time-orders/:orderId/payments/:paymentId/correct` |
| 291 | `POST /one-time-orders` |
| 299 | `POST /one-time-orders/:id/copy` |
| 308 | `PATCH /one-time-orders/:id` |
| 317 | `PATCH /one-time-orders/:id/review` |
| 326 | `DELETE /one-time-orders/:id/review` |
| 334 | `GET /one-time-orders/:id/specification-items` |
| 342 | `GET /one-time-orders/:id/specification-items/:itemId/comments` |
| 351 | `POST /one-time-orders/:id/specification-items/:itemId/comments` |
| 361 | `DELETE /one-time-orders/:id/specification-items/:itemId/attachments/:fileId` |
| 371 | `POST /one-time-orders/:id/specification-items/apply-catalog` |
| 380 | `POST /one-time-orders/:id/specification-items` |
| 389 | `PATCH /one-time-orders/:id/specification-items/reorder` |
| 402 | `PATCH /one-time-orders/:id/specification-items/:itemId` |
| 417 | `DELETE /one-time-orders/:id/specification-items/:itemId` |
| 426 | `POST /one-time-orders/:id/specification-items/:itemId/complete` |
| 439 | `POST /one-time-orders/:id/specification-items/:itemId/reopen` |
| 448 | `PATCH /one-time-orders/:id/status` |
| 457 | `POST /one-time-orders/:id/managers` |
| 466 | `DELETE /one-time-orders/:id/managers/:userId` |
| 475 | `GET /one-time-orders/:id/comments` |
| 483 | `GET /one-time-orders/:id/daily-report/today` |
| 491 | `PUT /one-time-orders/:id/daily-report/today` |
| 500 | `GET /one-time-orders/:id/photos` |
| 513 | `POST /one-time-orders/:id/photos` |
| 522 | `DELETE /one-time-orders/:id/photos/:photoId` |
| 532 | `POST /one-time-orders/:id/photos/:photoId/restore` |
| 541 | `POST /one-time-orders/:id/comments` |
| 550 | `GET /one-time-orders/:id/history` |
| 558 | `GET /one-time-orders/:id/history-page` |
| 567 | `GET /one-time-orders/:id/tasks` |
| 575 | `GET /one-time-orders/:id/equipment` |

### apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.controller.ts

| Source line | Method / route |
| --- | --- |
| 12 | `GET /rubber-mats/aggregate` |
| 19 | `GET /rubber-mats/catalog` |
| 20 | `POST /rubber-mats/catalog` |
| 21 | `PATCH /rubber-mats/catalog/:sizeId` |
| 22 | `GET /rubber-mats/catalog/:sizeId/history` |
| 29 | `GET /objects/:objectId/rubber-mats/aggregate` |
| 30 | `GET /objects/:objectId/rubber-mats/aggregate/history` |
| 31 | `PUT /objects/:objectId/rubber-mats/aggregate/:sizeId` |

### apps/backend/src/modules/rubber-mats/rubber-mats-registry.controller.ts

| Source line | Method / route |
| --- | --- |
| 22 | `GET /rubber-mats` |
| 27 | `GET /rubber-mats/available/:objectId` |
| 32 | `POST /rubber-mats` |

### apps/backend/src/modules/rubber-mats/rubber-mats.controller.ts

| Source line | Method / route |
| --- | --- |
| 27 | `GET /objects/:objectId/rubber-mats` |
| 32 | `POST /objects/:objectId/rubber-mats/:matId/assign` |
| 37 | `POST /objects/:objectId/rubber-mats/:matId/return-to-stock` |
| 42 | `PATCH /objects/:objectId/rubber-mats/:matId` |
| 52 | `POST /objects/:objectId/rubber-mats/:matId/move` |
| 69 | `POST /objects/:objectId/rubber-mats/:matId/service` |
| 79 | `GET /objects/:objectId/rubber-mats/:matId/history` |

### apps/backend/src/modules/search/search.controller.ts

| Source line | Method / route |
| --- | --- |
| 26 | `GET /search` |
| 34 | `POST /search/recent` |

### apps/backend/src/modules/tasks/tasks.controller.ts

| Source line | Method / route |
| --- | --- |
| 49 | `GET /tasks` |
| 57 | `GET /tasks/:id` |
| 65 | `POST /tasks` |
| 73 | `PATCH /tasks/:id/status` |
| 82 | `PATCH /tasks/:id` |
| 91 | `POST /tasks/:id/result` |
| 100 | `POST /tasks/:id/assignees` |
| 109 | `DELETE /tasks/:id/assignees/:userId` |
| 118 | `POST /tasks/:id/assignees/me/completion-draft` |
| 126 | `POST /tasks/:id/assignees/me/complete` |
| 135 | `POST /tasks/:id/assignees/me/undo-completion` |
| 143 | `POST /tasks/:id/confirm` |
| 151 | `POST /tasks/:id/complete-now` |
| 159 | `POST /tasks/:id/return-to-work` |
| 168 | `POST /tasks/:id/reopen` |
| 177 | `POST /tasks/:id/cancel` |
| 186 | `GET /tasks/:id/history` |
| 194 | `GET /tasks/:id/completions` |
| 203 | `GET /objects/:id/tasks` |

### apps/backend/src/modules/timesheets/timesheets.controller.ts

| Source line | Method / route |
| --- | --- |
| 49 | `GET /timesheets` |
| 57 | `GET /timesheets/export` |
| 77 | `GET /timesheets/overview` |
| 85 | `GET /timesheets/overview/references/objects` |
| 93 | `GET /timesheets/overview/references/employees` |
| 101 | `GET /timesheets/overview/export` |
| 121 | `GET /timesheets/corrections` |
| 129 | `POST /timesheets/entries` |
| 138 | `POST /timesheets/exceptions` |

### apps/backend/src/modules/user-absences/user-absences.controller.ts

| Source line | Method / route |
| --- | --- |
| 30 | `GET /user-absences` |
| 38 | `GET /user-absences/users` |
| 45 | `POST /user-absences` |
| 53 | `PATCH /user-absences/:id` |
| 62 | `DELETE /user-absences/:id` |

### apps/backend/src/modules/user-substitutions/user-substitutions.controller.ts

| Source line | Method / route |
| --- | --- |
| 12 | `GET /user-substitutions` |
| 13 | `GET /user-substitutions/options` |
| 14 | `POST /user-substitutions` |
| 15 | `POST /user-substitutions/:id/revoke` |

### apps/backend/src/modules/users-access/users-access.controller.ts

| Source line | Method / route |
| --- | --- |
| 25 | `GET /users-access/users` |

### apps/backend/src/modules/visit-plans/visit-plans.controller.ts

| Source line | Method / route |
| --- | --- |
| 32 | `GET /visit-plans/managers` |
| 37 | `GET /visit-plans/object-options` |
| 45 | `GET /visit-plans` |
| 50 | `POST /visit-plans` |
| 58 | `POST /visit-plans/:id/entries` |
| 67 | `PATCH /visit-plans/:id/entries/:entryId/visit` |
| 77 | `PATCH /visit-plans/:id/report` |
| 86 | `GET /visit-plans/:id/history` |
| 94 | `PATCH /visit-plans/:id/deadline` |
| 97 | `DELETE /visit-plans/:id/entries/:entryId` |

