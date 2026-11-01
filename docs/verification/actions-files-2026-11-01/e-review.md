# Role E review — actions/files pass (2026-11-01)

Comparison point: `6d59afa` (`HEAD`). This is a read-only QA review of the working diff. Initial scope covered frozen A/C/D while B changed. The final frozen check below includes B and supersedes the intermediate statuses retained later as an audit trail. E changed only its report and verification artifacts; no implementation edits, commits, pushes, dependency installs, or browser operations were performed by E.

## Final frozen result — E complete

- **33/33 targeted tests PASS, eight files**: table 1, preview 5, mobile actions 3, overflow 4, image lens 3, file presentation 3, media positioning 5, PDF functional 9. [Log](e-targeted-tests.log).
- **Full frontend typecheck PASS** with `--noEmit --incremental false`. [Log](e-typecheck.log). **Scoped ESLint PASS, 12 changed/new TS/TSX files**. [Log](e-scoped-eslint.log). `git diff --check 6d59afa` PASS.
- **Isolated frontend production build PASS, exit 0**, 61 routes and 50/50 static pages, Linux arm64 / Node v22.22.3 / Next 15.5.14. One worker, verified 988 MiB parent V8 heap; normal type/lint validation enabled. Build ran in `/tmp/crm-actions-e-final.hvBIoc`, with output inside its own `apps/frontend/.next`. No backend build was needed. [Build log](e-build.log), [metadata](e-build-result.json).
- **497 source/config files unchanged** before checks and after build; source SHA-256 in both snapshots: `d62f137c37e4026eaf1a199195f92c5bb986a5bdcb3874c3c31fce37c1081541`. Tracked source diff hash also matches. [Before](e-source-before.json), [after](e-source-after.json). Only the copied Next config received `experimental.cpus: 1`; the live config hash stayed unchanged, and live `.next` was not a build target. Final archive had zero Mac metadata entries; it used `COPYFILE_DISABLE=1` and excluded `._*`, `.DS_Store`, and `__MACOSX`.
- **Local PDF worker bundled**: `pdf.worker.min.fc1b73eb.mjs`, 1,182,501 bytes, SHA-256 `3a711552b821c9f85e541f6cd9f3be3a02cdf003c583e1b22b373c237973e210`. Manifest, lockfile, and actual Linux installation all identify **pdfjs-dist 6.4.299**. Its Node engine range is satisfied. No external viewer service or backend/CSP diff was introduced.
- **Single Terra finding verified**: `maxImageSize: -1` retains the oversized image instead of silently omitting it. E's real offline 4001×4000 fixture produced `paintImageXObject` and opaque black center pixels `[0,0,0,255]` in the rendered 200×200 canvas. [Fixture result](e-pdf-fixture-result.json). B's nine functional tests also pass. No further broad review was performed.

### Explicit limits and remaining known debt

The 25 MiB streamed input limit, load/render deadlines, abort handling, 32 MiB PDF.js resize threshold and 16 MP output cap are present. They **do not establish an absolute decoded-image/worker RSS guarantee**. The independent offline pixel probe uses PDF.js's supported Node legacy entry; it proves content retention, not browser OffscreenCanvas memory usage. Version 6.4.299 does not expose `isEvalSupported` in its API; E did not claim an unsupported flag was applied. The inspected distributed browser/worker files contain no `eval(` or `new Function(` matches.

Full CSS audit is **not PASS**: it reports only unused classes in four unchanged stylesheets (counterparties, rubber-mats, employee-workspace, object-list). It reports no undefined tokens, missing classes, or broken comments. [Audit log](e-css-audit.log). The successful production build retains nonblocking existing Autoprefixer `end`/`flex-end`, webpack warning-serialization, and missing Next ESLint-plugin warnings; no checks were suppressed. The superseded first build failed on archive metadata, is retained as `e-build-attempt1.*`, and is not used for acceptance.

Main owns LIVE acceptance: latest reports cover fresh XLSX rendering/125% zoom/reset/reload, JPG 1:1/fit/gallery, canonical TXT, narrow file/paperclip menus, 44 px header controls and toolbar fit, actual Edit activation/disclosure draft preservation, and visible/focused ТЗ/tasks headings (ТЗ top 80). E did not operate a browser. Actual **browser 200% zoom is NOT CHECKED**. Source inventory is not an all-buttons/all-mutations claim. Main's report remains separately owned by main.

## Initial findings (subsequent D verification below)

### [P2] One-time order actions overflow the 390 px registry toolbar

**Evidence:** live screenshot supplied by the main thread: `/private/tmp/crm-actions-pass-2026-11-01/orders-mobile-390.png`. At 390 px, “Каталог ТЗ”, “Календарь”, and “Создать заказ” are forced into one horizontal row; the create action extends beyond the right edge and is clipped.

**Source:** `apps/frontend/src/shared/ui/registry-filters/registry-toolbar.module.css:249-266` sets `.actions` to a non-wrapping flex row, then gives every direct action `width: 100%` below 680 px. The one-time order screen supplies all three actions at `apps/frontend/src/app/(app)/one-time-orders/page.tsx:206`. The toolbar source is unchanged in this diff; this is a confirmed live issue on the reviewed screen, not attributed as a regression from the changed files.

**Impact:** the primary create action is visibly clipped at a common phone width. Keep the mobile action arrangement within the available width; this finding does not prescribe full-width buttons as a general rule.

### [P2] Icon-button 44 px geometry depends only on the primary pointer type

**Source:** `apps/frontend/src/shared/styles/ui-foundation.css:284-288` uses the 36 px `--ui-control-md` size. The 44 px override at lines 768-777 only applies under `(pointer: coarse)`. The component contract at `docs/ui/COMPONENT_CONTRACTS.md:42` specifies 44 px touch targets on mobile and touch layouts.

**Impact:** a narrow hybrid device whose primary pointer is fine can still expose 36×36 shared icon buttons to touch input. A 390 px responsive viewport using a fine pointer has the same computed size. This is a project-contract hit-area gap; 36 px exceeds WCAG 2.2 AA's 24 px minimum, so this is not reported as a WCAG AA failure. The order-row full-card link has a separate 44×44 rule at narrow widths and is not implicated.

## Source checks

- Table row: the address is clamped on an inner span while the semantic `<td>` retains normal wrapping. Row preview click ignores nested links, buttons, and `[role="button"]`; keyboard activation is limited to the focused row itself. The edit preserves the full-card links as anchors.
- Preview links: `section=finance`, `section=execution`, and `section=materials` match real `WorkspaceTabs` values (`Финансы и ресурсы`, `Работы`, `Медиа`). This establishes valid tab values only; the ТЗ/tasks destination semantics fail the later C review below. `edit=1` opens overview edit mode only after the loaded order advertises `canEditOperationalFields`; no mutation is triggered by selection or link rendering. Edit activation and runtime fragment scrolling remain main's browser checks.
- ACL: no API, DTO, capability calculation, or backend access file is changed in the diff. Preview edit visibility now consumes `canEditOperationalFields`; the detail route applies the same capability before entering edit mode. No permission expansion is visible in the reviewed diff.
- Date/time: the touched preview now prefers loaded order execution dates over list dates. Its formatting helpers and the table's business-date formatter are unchanged from `6d59afa`; no current-time display or date algorithm change was found in the diff.
- Disclosure: review/comment forms are conditionally rendered and retain their controlled draft state while collapsed. Review and comment actions remain capability-gated. No post effect on selection was found.
- Overflow menu: source implements Escape close with trigger focus restoration, arrow/Home/End navigation across enabled items, scroll/resize dismissal, and placement bounded by viewport plus every clipping ancestor. Permission filtering remains the caller's responsibility; disabled actions retain visible reasons. No hidden-item or focus defect was found in the changed menu source. The placement/navigation tests cover flipping, clipping bounds, and Home/End behavior.
- Approvals/task: the approval change only applies the shared action-group class and narrow alignment; the task editor close action now uses a named `IconButton`. No approval or task mutation logic changed in those diffs.

## Verification

- Scoped Node tests: 8 passed, 0 failed (list/address interaction, preview section/edit URLs and disclosures, overflow positioning/navigation).
- Impeccable `Operate` audit detector: no findings for the scoped changed React targets.
- `git diff --check 6d59afa`: clean.
- No browser was opened or operated in this review. The 390 px toolbar observation is attributed to the main thread screenshot above. No mutation flow was exercised; this is not an all-buttons or all-mutations certification.
- No full typecheck or build was run: the B media/file-preview changes are still moving, and the requested freeze/coordination has not been received. No source files were edited by E.

## D frozen hotfix verification

Both initial P2 findings are addressed in source. Main still owns browser remeasurement; the original screenshot is evidence of the original failure only.

- `registry-toolbar.module.css:249`: action groups now wrap and bound children with `min-width: 0; max-width: 100%`. The mobile rule forcing every child to `width: 100%` is removed. Three order-toolbar links can wrap within the content width. An intentional full-width primary create action in another consumer is not itself a defect.
- `ui-foundation.css:768`: the target floor now applies at `max-width: 760px` or `any-pointer: coarse`. Icon buttons have 44 px width/min-width/height and cannot flex-shrink. This covers the narrow fine-primary-pointer case and hybrid touch input.
- `app-shell.css:1223`: actual header trigger selectors receive the same 44 px nonshrinking floor. Narrow header spacing, account width and hidden separator/chevron reserve room for the controls.
- `mobile-actions.test.mjs`: rerun by E, 3 passed, 0 failed. These tests check source rules and a width reservation calculation; they do not measure the rendered browser geometry.
- `git diff --check 6d59afa`: clean at this verification point.

## B provisional source findings — implementation still changing

The following refer to the observed `pdf-document-preview.tsx` snapshot and require rechecking after B freezes. They are not final acceptance results.

### [P2] Untrusted PDF page dimensions can allocate an unbounded canvas

`apps/frontend/src/shared/ui/media-entry/pdf-document-preview.tsx:87-92` limits scale and DPR but does not limit final pixel count or either canvas dimension. The minimum scale of 0.2 also prevents sufficiently downscaling unusually large page boxes. For example, a 1000×100000 point page at a 600 px container and DPR 2 requests roughly 492 MiB for the output RGBA canvas alone. A 25 MiB upload cap (`files.controller.ts:140`) does not bound this decoded memory. `getDocument({ data })` also leaves the PDF.js `maxImageSize` option unlimited. Add a deliberate pixel/dimension budget, constrain decoded images, and release page resources when navigation makes them unnecessary. Document-byte loading is currently whole-buffer; assess it against the server's preview-output bound rather than assuming the upload cap also caps converted output.

### [P2] Cancellation while the PDF library import is pending still starts loading

`pdf-document-preview.tsx:48-53` checks cancellation before `await import('pdfjs-dist')`, but does not check it after that await. Closing or changing the file while the import resolves runs cleanup with `loadingTask === null`; the continuation then creates a worker/loading task after cleanup. It is only destroyed after `loadingTask.promise` resolves. Check cancellation immediately after the import and before creating the task, so abandoned previews do not continue parsing large files.

### Worker/CSP and untrusted-content observations

- The dependency is pinned to `pdfjs-dist` 6.4.299 and the worker URL refers to the local package. No external viewer URL was found. Worker bundling/serving remains a runtime/build check after dependency recovery and freeze.
- `git diff --name-only 6d59afa -- apps/backend` is empty: the backend CSP change is reverted. The original file response keeps its sandbox CSP. Fetching its bytes for a canvas renderer does not itself require relaxing that response policy.
- This component invokes canvas rendering and text extraction; it does not instantiate the PDF scripting manager, an annotation HTML layer, or `dangerouslySetInnerHTML`. Extracted strings are React text. No concrete PDF-script execution path was found in this source review.
- The installed 6.4.299 API types expose `maxImageSize` and `canvasMaxAreaInBytes`; `isEvalSupported` is absent, so recommending that older flag would not fit this installed API. Mozilla's API reference documents the memory-related options: https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html.
- No heavy checks have run while B resolves the missing Next loader. Final regression review and full typecheck remain pending B freeze and coordination with main.

## C handoff findings — E stopped for owner fixes

### [P2] Quick preview puts review and payment before the approved execution context

**Requirement:** `docs/ui/ACTIONS_FILES_PASS_2026-11-01.md:14` specifies identity/status/dates/warnings, address/contact, managers/object, execution/tasks and direct links, recent permitted materials/comments, then compact payment conditions. Review is disclosed separately.

**Observed:** main's live 390 px capture `/private/tmp/crm-actions-pass-2026-11-01/quick-preview-390.png` shows summary, review, and payment before the operational content. E inspected the supplied image without operating a browser. The source confirms the complete DOM sequence: summary (`one-time-order-preview-drawer.tsx:318`), review (`341`), payment (`380`), execution (`393`), status action (`413`), comments (`461`). Material access is currently only a link in the execution section.

**Impact:** mobile users must scroll through review/payment before reaching the work they need to perform. This violates the approved business priority; working controlled disclosures do not satisfy the section-order requirement. C should place execution/tasks after summary, then permitted materials/comments, and compact payment later. Preserve the working controlled drafts and disclosure behavior.

### [P2] “Открыть работы и ТЗ” targets the daily report, and tasks lack a distinct destination

`one-time-order-preview-drawer.tsx:407` links to `?section=execution#one-time-order-daily-report`. That ID belongs to the **Дневной отчёт** surface (`features/one-time-order-report/ui/one-time-order-daily-report-panel.tsx:32-35`), not the specification. In the detail card, the specification is rendered at `app/(app)/one-time-orders/[id]/page.tsx:809`, followed by services, the daily report, then tasks (`833`). “Открыть задачи” currently only selects the whole execution tab (`drawer:408`), leaving the user at the start of unrelated content.

**Impact:** the ТЗ CTA directs the user to the report, and the tasks CTA does not locate the promised task section. C should give specification and tasks distinct stable destinations and make navigation reveal the matching panel before scrolling to its anchor. Anchor names are the owner's implementation choice; they must match the promised content.

**Test correction:** the current preview test asserts that the daily-report fragment exists in the CTA string. Its PASS is only a source-pattern match and currently reinforces the wrong destination. Acceptance must check the labeled destination's actual content, separate specification/tasks anchors, and main's browser navigation result. E's earlier tab-value check did not establish these semantics.

### Resume gate and remaining regression checks

E is stopped at main's request so C/B owners can finish. D's two source fixes remain verified; C's two findings and B's two provisional findings are open pending owner updates. Main retains Edit browser testing. Resume E after C/B freeze and dependency recovery for final changed-file review, distinct CTA destinations, ordered preview sections, retained drafts/ACL/date behavior, PDF cancellation and memory limits, and the full frontend typecheck. The typecheck is assigned to E after that gate; it has not been executed or reported as passing. No build has run.

## Resumed verification — C/D frozen; B zoom controls still moving

### C findings addressed in frozen source

- DOM now orders summary/warnings, execution/tasks and section links, status action, comments, payment, then separately disclosed review. The two original business-priority blocks no longer precede execution. Permitted materials remain available through the media section link; a recent-materials preview has not been implemented or accepted by this source check.
- ТЗ and tasks now have distinct matching anchors: `#one-time-order-specification` wraps `OneTimeOrderSpecificationPanel`; `#one-time-order-tasks` wraps `OneTimeOrderTasksPanel`. The old report fragment is absent from these preview CTAs. The card waits until loading ends and execution is visible, then focuses and scrolls to the matching anchor on the next animation frame. The comments “Все” link now selects discussion.
- C's four targeted tests pass in E's integrated run. Main reports actual Edit form activation and collapsed draft preservation PASS. Main also reports D's 390 px controls are 44 px and toolbar buttons fit. These are main's live results, not browser actions by E.
- Main reports the local PDF.js XLSX sample renders in `pdfjs-xlsx-render-1280.png`; E has not independently exercised it. Backend changed-file inventory remains empty.

### Current tests and lint

- E reran the current six targeted files: order table, preview drawer, mobile actions, overflow navigation, image lens geometry, and file type presentation. **18/18 PASS**.
- Full frontend ESLint passed. The frontend lint command then failed its CSS audit: the new PDF canvas uses undefined `--ui-shadow-card` in `shared/ui/media-entry/file-viewer.module.css`. This is a current B-owned lint blocker; use the established style contract instead of inventing a token.
- CSS audit also reports unused classes in the unchanged counterparties, rubber-mats, employee-workspace, and object-list stylesheets. These are recorded separately from the new media failure; E has not changed those files or expanded this task to clean them up. Full lint is therefore not PASS.
- B's current zoom implementation now caps the output canvas at 16,000,000 pixels (about 61 MiB RGBA); the original unbounded output-canvas allocation is addressed at this snapshot. `getDocument({ data })` still leaves decoded PDF images unlimited, and the post-import cancellation check is still absent. Those portions of the provisional findings remain open while B changes source.

### Resource plan — reported before heavy execution

- Sequence: targeted tests → lint → full frontend typecheck after explicit B-freeze notice → separately authorized isolated frontend production build. No backend build is needed: the backend diff is empty.
- Prior successful pattern: `docs/verification/creation-forms-2026-10-31/build-result.json`, isolated container copy `/tmp/crm-E-production.0iMsyG`, `experimental.cpus: 1`, `NODE_OPTIONS=--max-old-space-size=1024 --max-old-space-size-percentage=12`, source fingerprints unchanged before/after. Follow the pattern using a fresh temporary directory, never that old directory.
- Current read-only runtime probe: `service_ops_frontend`, Linux arm64, Node v22.22.3, Next 15.5.14; VM RAM about 7.65 GiB, no cgroup memory/CPU cap. The prior flags give **988 MiB V8 heap in both parent and child** in the current runtime. This limits each V8 heap, not aggregate RSS.
- Run resource-consuming checks serially. For an authorized build, copy the frozen frontend and required workspace files into a new container temporary directory with Linux-compatible installed dependencies. Change `experimental.cpus` only in that copy, keep type/lint failures enabled, and compare source fingerprints before/after. Build output/config must stay away from the running app's `.next` and source config. Do not install or update dependencies as part of QA.
- Full typecheck is reserved to E after B freeze; no typecheck or build has run in this resumed pass. Build execution is not yet authorized. Main remains the sole browser operator.

## Latest C finding — correct destination is obscured by fixed header

### [P2] Execution anchors scroll the section heading behind the app header

Main's actual navigation to ТЗ focused `#one-time-order-specification` and selected the correct execution panel, but measured the target at `rect.top = -0.1` while the fixed header occupied 64 px. This establishes correct destination/focus, **not complete navigation acceptance**: the section title is hidden behind the header. No new screenshot was supplied for this observation; the measurement is attributed to main.

Source: `app/(app)/one-time-orders/[id]/page.tsx:237` calls `scrollIntoView({ block: 'start' })`. Its anchor wrappers at lines 830 and 856 have no class or offset styling. No applicable scroll margin/padding was found on these destinations. The existing `oneTimeOrderReviewSection` scroll margin belongs to another section and does not cover these wrappers. Tasks use the same scroll code and lack the same offset; main should verify their final geometry too.

C should give both section anchors an appropriate scroll margin based on the actual fixed-header offset plus spacing. Do not assume the 56 px base token matches the measured 64 px header in every layout. Acceptance requires the ТЗ and tasks titles to remain visible below the header after navigation, with correct focus and section selected. C may make this small fix after B completes; E remains stopped until the agreed freeze notice.

Latest coordination: main has approved the later isolated build with one CPU and verified 988 MiB heaps, after B freeze and typecheck/targeted checks. Build execution remains gated on that freeze. Actual browser 200% zoom remains explicitly **NOT CHECKED**. Backend/CSP diff remains reverted; no backend build is planned.

## B freeze revoked — deterministic PDF rendering regression

### [P1] Renamed page variable prevents every PDF page from rendering

E's authorized full frontend typecheck failed with `TS2304: Cannot find name 'page'` at `shared/ui/media-entry/pdf-document-preview.tsx:96` (exit 2). The file now assigns `pageProxy = await documentProxy.getPage(pageNumber)` and uses that variable elsewhere, but the scaled viewport still calls `page.getViewport(...)`.

This directly explains main's new empty-canvas/error result and repeated retry failure: after obtaining the page, the undefined variable throws before canvas sizing or `pageProxy.render`. The catch maps that exception to “Не удалось отобразить эту страницу.” Retrying follows the identical failing path. This is a deterministic source explanation of the reported symptom; E did not operate the live browser or inspect its JavaScript exception. B must correct the reference, then rerun typecheck and main must retest the actual file. The earlier working screenshot cannot accept this newer snapshot.

The 16 MP image cap and 32 MiB decoder-canvas threshold are not the demonstrated cause of this error: this undefined variable fails before rendering invokes image decoding. Those limits can affect oversized embedded images, but lowering/removing them is not justified by the current failure. The requested cancellation guard after the PDF import and document/render abort paths are now present. The output canvas has a 16,000,000-pixel cap. No PDF scripting manager/HTML injection path or new backend/CSP change was found in this focused review; this is not a universal security certification.

### Current C final CSS verification

Both anchor wrappers now have `styles.executionAnchor`, whose scroll margin is `calc(max(var(--ui-topbar-height), 64px) + var(--ui-space-4))`. This addresses the measured 64 px fixed-header overlap plus spacing in source. C's suite now contains five tests. Main still owns the new visible-title geometry acceptance.

### Current executed checks and dependency metadata

- Full frontend typecheck: **FAIL**, single reported error above; no incremental cache was written (`--noEmit --incremental false`). Build is held after main revoked B freeze.
- After C's final CSS/test change, E reran all seven targeted files together: **24/24 PASS** (table 1, preview 5, mobile actions 3, overflow navigation 4, lens geometry 3, file presentation 3, media-action positioning 5). These tests do not exercise the PDF React render path and therefore did not detect the undefined variable; the full typecheck did.
- Full frontend ESLint passes. CSS audit now has no PDF token error; it still fails on unused classes in the four unchanged stylesheets recorded earlier. Do not report full frontend lint PASS.
- Manifest and lockfile both pin `pdfjs-dist` **6.4.299**. Lockfile integrity is `sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`.
- Actual Linux install metadata: PDF.js 6.4.299, engine requirement `>=22.13.0 || >=24`, current Node v22.22.3, Next 15.5.14. Installed local worker exists at `/workspace/node_modules/.pnpm/pdfjs-dist@6.4.299/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`, size **1,264,342 bytes**. The Next flight-client-entry loader resolves again. E did not install/update dependencies.
- Backend changed-file list is empty, including the previously reverted CSP change. Local package worker/source contains no external viewer integration. Final worker-bundle verification remains part of the held isolated build.

## Latest pre-Terra-fix checkpoint — heavy work held

- Stale `page` reference fixed; full frontend typecheck now **PASS** (exit 0, `--noEmit --incremental false`).
- Current integrated targeted run: **28/28 PASS**, eight files (the prior seven suites plus four PDF effect tests). Scoped ESLint: **PASS, 12 changed/new TS/TSX files**. Source fingerprints were unchanged across these checks. Logs and fingerprints: `e-targeted-tests.log`, `e-typecheck.log`, `e-scoped-eslint.log`, `e-css-audit.log`, `e-checks-result.json` in this directory.
- CSS audit has no undefined tokens, missing classes or broken comments. It still reports unused classes in four unchanged stylesheets, so full frontend lint is not represented as passing.
- The already-started isolated snapshot build finished with exit 1 because macOS archive metadata became `._*.tsx` files in its temporary source copy and failed parsing. It is an invalid staging attempt, not an accepted source build. Live config hash stayed unchanged; worker asset compilation did emit a local `pdf.worker.min.*.mjs`. No build process remains running. The replacement archive will explicitly exclude metadata; final build waits for B's new freeze.
- Terra's single P2 reopens B only for oversized-image handling. Installed PDF.js 6.4.299 checks image dimensions against `maxImageSize`, and under its default recovery behavior warns and returns without image paint operators. E's bounded offline synthetic PDF (4001×4000 grayscale image; 16,004,000 pixels; 16,250-byte PDF) reproduced successful processing with the image omitted. A strictness probe alone did not establish a reliable application-level failure signal, so `stopAtErrors` is not accepted as a fix on assumption. Verify B's actual explicit-failure/download or supported-resize behavior once changed, without another broad review.
- Main's latest LIVE report: XLSX rendering/125% zoom/reset/reload PASS; JPG 1:1/fit/gallery PASS; canonical TXT PASS; file menu and paperclip menu fit at 390; ТЗ anchor top 80 with title visible and correct focus; tasks title/focus visible at 390. E attributes these results to main. Actual browser 200% zoom remains **NOT CHECKED**.
