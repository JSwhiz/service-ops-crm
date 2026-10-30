# Frontend object setup — 2026-10-28

Owner: FE. Writes limited to apps/frontend. No commits, backend edits or browser work.

Chosen consumers: objects/new/page.tsx; objects/[id]/page.tsx (#overview, #team, #today); objects/[id]/edit/page.tsx.
Reusable domain composition: features/object-setup (optional contract/setup fields), features/object-scheduling (position, rule, intervals, groups, dated employee assignments, server preview/read states).
Existing primitives: Field, Button, Surface, Alert, SearchableSelect, Select, DatePicker; CSS Modules with existing --ui-* tokens. Form max width 800px; extended creation 1040px.

API sources: backend object-scheduling/SCHEDULING_API.md and final core contract at /Users/dmitrijkruckov/Documents/Codex/2026-09-27/new-chat/be-core/CORE_API.md (outside repo, as supplied by ORCH). No local calendar simulation. Existing object employee-directory supplies scoped choices; creation uses listEmployees only with registry + assignment capabilities.
Legacy attendance/timesheet handlers and monetary calculations remain owned by their existing implementation.

Implemented: creation sends nested setup/contacts/staffingPositions/payContours/planning; optional internalName/responsibleUserId. Shared contact, setup, position, pay-contour and season fields serve creation and editing. Server previews work before creation and in object scope. #overview has setup; #team has positions/contours; #today has expected and confirmed shifts with explicit confirmation. Legacy attendance handlers are unchanged.

Latest steering: seasonality is only off (base) or on (AUTO by explicit annual boundaries), no manual summer/winter selection. planning is sent atomically on creation; existing objects save it through PATCH planning. No guessed boundary months. Creation hides summer/winter compensation profiles while off through optional showSeasonalProfiles (default true for other consumers), retaining their controlled draft values. An incomplete hidden seasonal schedule produces an explicit visible warning, not a silently repaired/discarded value. Existing pay-profile schedule is labelled as monthly calculation norm, distinct from position shift planning. 5/2 weekly is the first/default position preset. Selecting 2/2 adds a missing partner phase without removing original groups, assignments, interval keys or contour bindings. Prominent position pay selector maps e.g. «Уборщица» to «Уборка» and applies selection to ranges; individual day/night ranges can override it.

Known API limitation for ORCH: auth/create context currently exposes no coefficient/budget capability. Coefficient editing therefore uses only returned setup.canEditCoefficient after creation; creation budget writes conservatively allow founder/director. Additional creation grants need a server capability rather than frontend identity inference. No backend changes made here.

Final verification after last runtime edit, 2026-10-29: frontend typecheck PASS; frontend lint PASS (CSS audit 77 files, no orphan/missing classes or undefined tokens); 11 editor/client checks PASS; git diff --check PASS. Browser/visual verification belongs to ORCH, not performed by FE; no refresh or other interaction with ORCH's unsaved browser form. No frontend build or .next build started. Backend/DB tests belong to ORCH and are not claimed as FE-run tests.

Browser follow-ups completed: setup read fields now use block label/value elements on existing ui-detail-* styles; source presentation translates applied to проведённые. Position/range selection uses selectPayConditions, separately from manageRates for contour creation/editing. Active options only, with existing out-of-list saved selection preserved. Server capability confirmed in updated SCHEDULING_API.md/service.

Today shifts: onDayStateChange (stable callback with safe default) reports checked/pending/confirmed ownership and employees to parent. Legacy daily attendance displays actual confirmed employee IDs and disables checkbox/hour/rate/submit controls with an explanation while shifts own the day or verification/mutation is pending. Legacy handlers/calculations unchanged. No confirmed shifts → old form remains available. onChanged refreshes parent attendance/employees after confirmation AND cancellation. Today-only cancel uses shared ReasonDialog, required reason and expectedVersion; errors preserve reason. History retained; requests Map.delete after cancellation ensures a new requestKey on re-confirm. Cancelled facts from refresh also clear old request keys.

Legacy season read: when automaticSeasons=false but activeSeason is summer/winter, show actual legacy profile and a notice. No read-time rewrite, guessed boundaries or bulk mutation. Explicit save of off normalizes through backend to base.

FE source fully settled for ORCH restart/build/browser retest. Intermediate HMR callback mismatch is guarded by default callbacks; final typecheck/lint pass. FE did not refresh the browser.

DatePicker AX follow-up: required validation shim already had aria-hidden=true and tabIndex=-1. Added disabled forwarding and onInvalid preventDefault + focus on the visible labelled trigger, avoiding native validation focus on the hidden textbox. Re-ran frontend typecheck/lint/CSS audit and diff whitespace check: PASS. No browser refresh; AX retest belongs to ORCH.

Frontend checks:
- pnpm --filter frontend typecheck
- pnpm --filter frontend lint
- node apps/frontend/scripts/verify-object-editor.cjs (11 cases, including current-day confirmed ownership/cancellation, weekly default, non-destructive 2/2, overnight binding, nullable staffing, preserve groups, ACL omission, annual/once budgets, numeric contours, atomic payload, client routes/conflict propagation)

Client requests exercised with a recording fetcher (not real HTTP):
- POST /objects (nested setup, positions, payContours and planning)
- POST /object-scheduling/preview
- POST /objects/o1/scheduling/preview
- GET, POST /objects/o1/scheduling/positions
- PUT /objects/o1/scheduling/positions/p1
- GET, POST /objects/o1/scheduling/contours
- PATCH /objects/o1/scheduling/contours/c1
- GET /objects/o1/scheduling/attendance?from=2026-11-01&to=2026-11-01
- POST /objects/o1/scheduling/attendance/confirm
- POST /objects/o1/scheduling/attendance/a1/cancel (expectedVersion + reason)
- GET, PATCH /objects/o1/setup
Existing /employees and /objects/:id/employee-directory are consumed by selectors; browser execution is pending ORCH. No new frontend routes: affected routes are /objects/new, /objects/[id]#overview/#team/#today/#planning, /objects/[id]/edit.

Files changed (all under apps/frontend):
- src/app/(app)/objects/new/page.tsx
- src/app/(app)/objects/[id]/page.tsx
- src/app/(app)/objects/[id]/edit/page.tsx
- src/entities/object/api/object-client.ts
- src/entities/object/api/object-scheduling-client.ts
- src/entities/object/api/object-setup-client.ts
- src/entities/object/model/object-scheduling.types.ts
- src/entities/object/model/object-setup.types.ts
- src/features/object-compensation/ui/object-compensation-profiles.tsx
- src/features/object-attendance/ui/object-attendance-panel.tsx
- src/features/object-contacts/ui/contact-editor.tsx
- src/features/object-contacts/ui/object-contacts-panel.tsx
- src/features/object-edit/ui/object-edit-form.tsx
- src/features/object-edit/ui/object-edit-panel.tsx
- src/features/object-planning/model/season-planning.ts
- src/features/object-planning/ui/season-fields.tsx
- src/features/object-planning/ui/object-planning-panel.tsx
- src/features/object-scheduling/model/contour-draft.ts
- src/features/object-scheduling/model/schedule-draft.ts
- src/features/object-scheduling/model/shift-day-state.ts
- src/features/object-scheduling/ui/object-scheduling-panel.tsx
- src/features/object-scheduling/ui/object-scheduling.module.css
- src/features/object-scheduling/ui/pay-contour-editor.tsx
- src/features/object-scheduling/ui/pay-contours-panel.tsx
- src/features/object-scheduling/ui/position-editor.tsx
- src/features/object-scheduling/ui/positions-editor.tsx
- src/features/object-scheduling/ui/schedule-preview.tsx
- src/features/object-scheduling/ui/today-shifts-panel.tsx
- src/features/object-setup/model/setup-draft.ts
- src/features/object-setup/ui/object-setup-editor.tsx
- src/features/object-setup/ui/object-setup-panel.tsx
- src/features/object-setup/ui/object-setup.module.css
- src/shared/ui/date-picker/date-picker.tsx
- scripts/verify-object-editor.cjs
- FE_IMPLEMENTATION.md
