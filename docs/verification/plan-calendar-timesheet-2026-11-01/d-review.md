# Independent review: plan, calendar, timesheet

Baseline: 42c7166fcc932bad11d5441d28db3b91a7344501. Date: 2026-11-01.
D owns only this verification directory. No application files were edited by D.

## Final summary — freeze3

D's addressed review, integrated checks and final isolated production build are complete. No confirmed open P1/P2 remains from the reviewed findings within the limits below. Main reports final B acceptance at 390/768/1280/1600 and passing live vertical keyboard reveal/read-only drawer focus checks.

| Check | Final result |
|---|---|
| Application target suites | PASS, 25/25 across calendar helpers, cell presentation, matrix navigation and overview refresh |
| D independent addressed checks | PASS, 7/7; total integrated run 32/32 |
| Full frontend TypeScript, no emit / incremental false | PASS |
| Scoped ESLint, including shared icons and new overview helper | PASS, 14 changed/new TS/TSX files |
| Full CSS audit | Same four unchanged-module reports as prior E audit; no changed B/C module defect |
| Whitespace diff check | PASS |
| Final isolated production build | PASS, exit 0; 61 routes; 50/50 static pages |
| Source/config fingerprints | All 512 unchanged across final checks and build |

Latest evidence: [checks](d-checks-freeze3.json), [raw tests](d-freeze3-targeted-tests.log), [TypeScript](d-freeze3-typecheck.log), [scoped ESLint](d-freeze3-scoped-eslint.log), [CSS audit](d-freeze3-css-audit.log), [build result](d-build-result.json), [build log](d-build.log).

## Addressed findings — behavior and source evidence

### C / P2: vertical arrow movement must reveal the focused row

Independent geometry checks execute the real getCellRevealScroll helper on 56 rectangle cases, covering rows below the viewport, above/under the sticky header, and simultaneous horizontal clipping. They verify the entire focused cell lands inside the visible matrix bounds. Source wiring calls matrix scrollBy on focus after target.focus with preventScroll, using client dimensions and measured header height.

Locations: [geometry helper](../../../apps/frontend/src/features/timesheet-grid/model/matrix-navigation.ts), [scroll region:43](../../../apps/frontend/src/features/timesheet-grid/ui/timesheet-scroll-region.tsx:43).

Main's LIVE retest passes: 16 Down reached scrollTop 726.5, with focused cell 579.8–623.8 inside viewport 266.5–815.1 and below sticky header 266.5–322.3. Sixteen Up returned scrollTop to zero, cell top 338.8 at or below header bottom 330.8. Main also passed desktop Enter/read-only details/Escape/focus return and 390px Enter/close/focus return.

### C / P2: refetch must retain the grid/drawer and block stale actions

The real overview refresh helper retains the same snapshot and row identity through same-scope loading and failed reads. A failed read cannot unlock old amounts; only the requested fresh revision does so. Independent source assertions confirm the page renders the grid from overview rather than loading/error and keys it only by period/object/employee; row and day keys stay stable across refetch.

The editor's success message is local state, with no data-revision effect clearing it. Source guards in both parent mutation handlers reject stale operations; canMutate, submit/restore guards and disabled controls enforce that state in the editor. This removes the original loading-driven unmount cause for retained rows.

Locations: [refresh state:4](../../../apps/frontend/src/features/timesheet-overview/model/overview-refresh.ts:4), [parent guards:190](../../../apps/frontend/src/app/(app)/timesheet/page.tsx:190), [stable render/key:270](../../../apps/frontend/src/app/(app)/timesheet/page.tsx:270), [editor](../../../apps/frontend/src/features/timesheet-cell-editing/ui/timesheet-cell-editor.tsx).

**Limit:** these are executed state-helper checks plus actual TSX wiring assertions, not a mounted React save/refetch interaction test. The installed runtime has no react-test-renderer, jsdom or happy-dom, and none was installed. Actual DOM focus after the editing footer changes on successful save is not accepted by this evidence. Main's read-only drawer focus checks are distinct and passed.

### C / P2: pending 409 must show an actionable response

The independent fixture runs the actual fetcher implementation against mocked Responses. The exact legacy pending-409 message was checked against backend source, decoded into ApiError, and mapped to wait/history guidance with duplicate sending blocked. A separate version-conflict response maps to refresh-and-compare guidance. Generic/unknown failures do not echo backend diagnostics and require a newer data revision before retry.

Locations: [error mapping:20](../../../apps/frontend/src/features/timesheet-cell-editing/model/cell-presentation.ts:20), [retry gate:42](../../../apps/frontend/src/features/timesheet-cell-editing/model/cell-presentation.ts:42).

No live network or money POST was used by the fixture. The pending-request latch is local; automatic re-enabling after approval/rejection was not tested or claimed.

[Independent evidence test](d-freeze3-addressed.test.mjs), [structured addressed results](d-addressed-freeze3.json).

## Final build isolation

Build completed at 2026-11-01T09:42:12.905Z. Runtime: service_ops_frontend, Linux arm64, Node v22.22.3 / Next 15.5.14. One worker; measured 988MiB V8 heap limits in parent and child. This is a per-process heap limit.

Fresh copy: /tmp/crm-d-freeze3-build.DVlCpF. Output: its own apps/frontend/.next. All 508 copied files matched originals before the sole copy-only override, experimental.cpus: 1. Metadata entry count was zero. Live source config remained unchanged, no dependencies were installed, and live .next/config/cache/env were not build targets. No service was restarted.

Before/after source/config digest (512 files):
54a47950dc7c9f6e186f4d8f933f9c05e89dc39ae2afe72a70d0782c07463669.

[Before fingerprints](d-source-before-build.json), [after fingerprints](d-source-after-build.json). The freeze2 build is retained separately as [provisional metadata](d-build-freeze2-result.json) and [log](d-build-freeze2.log).

## Baseline findings and remaining limits

CSS audit still reports unused classes in unchanged counterparties, rubber-mats, employee-workspace and object-list modules, exactly matching the preceding E audit. Build warnings remain the pre-existing autoprefixer end/flex-end warning in unchanged one-time-order-compact-actions.module.css and the missing Next ESLint plugin warning. Full frontend lint is not represented as globally clean.

D performed no browser checks, live money mutation/save/reload, backend/database tests, migrations, schema edits, dependency install or service restart. Main is the sole browser operator. **Live save + reload is not accepted.** No complete React interaction claim is made for asynchronous correction success/failure, pending approval resolution, or focus after a real save. Synthetic geometry/source evidence and main's read-only LIVE checks establish the narrower results above. Actual zoom200% and physical touch are not established by D.

B source keeps canManage/manager selection and user-calendar self/all/private-reason boundaries. Its frozen refinements include RefreshIcon, validated URL date fallback, non-clearable picker/empty guard, capped manager width, neutral empty copy, mobile three-column date navigation with Today on the next row, grouped count/label pairs, and size=lg create button. No business formula, ACL or API change was made or certified by this UI review. The all-width inspector Drawer remains an approved simplification.

## Chronology — prior findings and resolved snapshots

1. Initial integrated pass: 14/14 tests and scoped lint passed; full TypeScript failed on B's optional date destructuring and C's unsupported Field.help. D also reproduced the empty URL date crash. Main's live check found mobile date clipping. Build was held.
2. Freeze2 fixed those source issues: date parsing/setUTCDate, validated resolveIsoDay URL fallback/regression, Field.description and mobile grid. Tests became 15/15; full types/scoped lint passed. The first isolated build passed but was later labeled provisional.
3. Terra's completed review found the three C P2s above. C resumed; D held final build until freeze3. No second full Terra review was requested.
4. Freeze3: C's 21 targeted tests plus B's four pass; D added seven independent addressed checks. Full types/scoped lint pass, baseline CSS unchanged, and a fresh final isolated build passes. Main supplied passing live vertical/read-only-focus and B viewport evidence. The final summary above supersedes the older provisional state.

Earlier d-typecheck.log and d-date-edge-probe.log preserve superseded initial failures. Freeze2 raw checks and provisional build remain historical evidence.

## Guidance used

Repository AGENTS.md and the specified product/access/UI contracts; local Vercel web-design-guidelines skill with fresh upstream rules fetched on 2026-11-01; Vercel React Best Practices. Project contracts retain priority over external style suggestions.
