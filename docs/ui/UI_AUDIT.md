# UI Inventory

## Executive technical summary

Аудит выполнен по `apps/frontend/src` без изменения application code, CSS или backend.

- Frontend использует Next App Router: root redirect `/` → `/dashboard`, публичный `/login`, остальные пользовательские экраны находятся под `(app)` и защищаются `AppLayout`/auth provider.
- Инвентарь содержит 43 `page.tsx`: 41 route screen внутри `(app)`, `/login` и root redirect; часть коротких страниц является thin wrapper над feature UI.
- UI сформирован двумя слоями. Новый нейтрально-тёплый foundation опирается на `design-tokens.css`, `ui-foundation.css`, `product-shell*.css`; старый слой сосредоточен в `app/globals.css` и использует холодную blue-палитру, градиенты и отдельные глобальные классы.
- Shared shell уже выражен компонентами Sidebar, Header/Topbar, PageTitle, command/search, avatar, searchable/user select и media controls. При этом многие domain screens продолжают собирать собственные surfaces, forms, alerts и loading/empty/error states.
- Главные зоны visual debt: `globals.css` (4 853 строки), `chats/page.tsx` (2 502), `employees/[id]/page.tsx` (1 104), `inventory/[id]/page.tsx` (688), `objects/new/page.tsx` (643), object registry/detail CSS (585/611 строк), inline styles и browser-native dialogs.
- Responsive стратегия смешанная: shell и новые dashboard/object screens имеют явные media queries; часть registry/table screens переключается на mobile-list; старые domain screens полагаются на глобальные правила или сохраняют широкую таблицу с горизонтальным overflow.

## Existing visual foundation

### Shell

- `app/(app)/layout.tsx` подключает app shell и auth boundary.
- `shared/ui/app-shell/app-shell.tsx` / `.client.tsx` — layout контейнер, sidebar + topbar, responsive shell state.
- `shared/ui/app-shell/app-sidebar.tsx` — permission-aware navigation, русские labels, отдельные пункты approvals, objects, orders, accountability, inventory, equipment, tasks, timesheet, candidates, employees, settings.
- `shared/ui/app-shell/app-header.tsx` — page context/topbar, global create menu, global search, notifications, profile/menu actions.
- `shared/styles/product-shell.css`, `product-shell-wave-1-1.css`, `topbar-communication.css` — shell-wide styles; `globals.css` всё ещё содержит значительный конкурирующий shell/global слой.

### Tokens and primitives

- `shared/styles/design-tokens.css` содержит canvas/surface/text/border/accent/danger/warning/success/info, radius, spacing, typography, shadow and focus tokens. Основная accent palette — тёплая brown/neutral.
- `shared/styles/ui-foundation.css` содержит `.page-card`, buttons, badges, inputs, notices, surface/section patterns; часть компонентов использует эти primitives через глобальные классы.
- `shared/ui/page-title/page-title.tsx` — наиболее повторяемый heading pattern.
- CSS Modules покрывают login, shell client, month picker, object registry/list/detail/new, staffing/team/feed, workforce, dashboard drawers and accountability queue; modules не образуют единую component-level taxonomy.
- `app/globals.css` задаёт альтернативные `--primary` blue tokens, глобальные `.page-*`, form/button/table patterns и множество domain-specific selectors. Это источник token drift и cascading coupling.

### Recurring interaction primitives

Фактически повторяются: page title/header + actions, bordered card/surface, section header, table/list row, filter row, status badge, inline notice, form field/label, pagination, drawer/preview, media attachment list, month picker, searchable select, user search select, command palette, avatar. Большинство не оформлено как единые shared React primitives.

## Reference implementations

| Area | Current reference | Why it is useful as inventory reference |
|---|---|---|
| App shell | `shared/ui/app-shell/*` | Permission-aware navigation, topbar actions, responsive shell boundary, global search/create entry points. |
| Sidebar | `shared/ui/app-shell/app-sidebar.tsx` | Canonical module navigation and access-driven visibility. |
| Topbar | `shared/ui/app-shell/app-header.tsx` | Shared page context, notifications, search, profile and create actions. |
| Login | `app/login/page.tsx` + `shared/ui/login-form/*` | Isolated public flow with local CSS Module, explicit error alert and responsive split layout. |
| Dashboard | `app/(app)/dashboard/page.tsx` + `features/dashboard/ui/*` | Most developed surface system: role router, panel/row/KPI primitives, drawers, responsive grid. |
| Objects registry | `app/(app)/objects/page.tsx` + `object-list/*`, `object-filters/*`, preview drawer | Registry, filters, row/table and mobile strategy are separated into feature components. |
| Object creation | `app/(app)/objects/new/page.tsx` + `new-object.module.css` | Complete form flow and object-specific responsive layout, but unusually large page/CSS pair. |
| Object detail | `app/(app)/objects/[id]/page.tsx` + object workspace CSS/features | Workspace composition of summary, status, team, staffing, arrival, report, comments, files/history. |

Эти экраны являются существующими техническими references, а не эстетической рекомендацией.

## Route inventory

| Module | Route | Screen type | Main components | CSS source | Legacy debt | Mobile strategy | Priority | Reference status |
|---|---|---|---|---|---|---|---|
| Auth | `/login` | utility | `LoginForm` | `login.module.css` | local hard-coded warm colors | split layout collapses in media query | P2 | REFERENCE |
| Core | `/dashboard` | dashboard | role router, leadership/manager/HR/operation dashboards | dashboard modules + dashboard-workspace.css | several parallel dashboard primitive styles | responsive grids and stacked panels | P2 | REFERENCE |
| Objects | `/objects` | registry | filters, object list table, preview drawer | objects-registry.module.css, object-list-table.module.css, object-preview-drawer.module.css | duplicate registry/table styling; raw table | mobile list/card variant | P2 | REFERENCE |
| Objects | `/objects/new` | creation/edit form | object form, user selects, sections | new-object.module.css | 643-line page and 602-line CSS; raw select/form composition | grid collapses | P1 | MIGRATE |
| Objects | `/objects/[id]` | entity detail/workspace | summary, state, status, team, staffing, arrival, report, comments, files, inventory | object-detail-workspace.module.css + shared object styles | 565-line composition; many bespoke panel states | workspace stacks/overflow rules | P1 | REFERENCE |
| Objects | `/objects/[id]/edit` | creation/edit form | `ObjectEditForm`/panel | global + object styles | inline styles/raw select in object edit feature | form grid collapse | P1 | MIGRATE |
| Objects | `/objects/[id]/history` | entity detail/workspace | history list | global page-card | own history empty/loading treatment | single column | P2 | POLISH |
| Orders | `/one-time-orders` | registry | order list table | global + feature table | raw table; thin page wrapper | table/list behavior via feature | P1 | MIGRATE |
| Orders | `/one-time-orders/new` | creation/edit form | order form, confirmation | global + feature styles | native confirm; large local interaction logic | form grid responsive | P1 | MIGRATE |
| Orders | `/one-time-orders/[id]` | entity detail/workspace | summary, specification, managers, tasks, photos, files, comments, report, review, accountability | global + feature styles | 728-line page; many panel-local states and confirms | mixed stacked panels | P1 | MIGRATE |
| Orders | `/one-time-orders/[id]/workforce` | operational matrix | workforce/calendar controls | workforce.module.css | separate workforce styling | explicit mobile media query | P1 | MIGRATE |
| Orders | `/one-time-orders/calendar` | operational matrix | calendar feature | global/feature styles | 19-line wrapper; calendar-specific patterns | feature-owned | P2 | MIGRATE |
| Orders | `/one-time-orders/attention` | queue | attention table/list | global | raw table and bespoke queue surface | wide table with horizontal overflow | P1 | MIGRATE |
| Tasks | `/tasks` | registry | task list table, filters | global + task feature | raw table; thin wrapper | feature-defined list behavior | P1 | MIGRATE |
| Tasks | `/tasks/new` | creation/edit form | task form | global + task feature | thin wrapper; local form states | form responsive via global rules | P2 | MIGRATE |
| Tasks | `/tasks/[id]` | entity detail/workspace | task summary, result, assignees, confirmation actions | global | 460-line detail; native prompt/confirm | stacked detail/actions | P1 | MIGRATE |
| Timesheet | `/timesheet` | operational matrix | filters, grid, overview, corrections, legend, month picker | timesheet-page.css, timesheet-editing.css | domain CSS is large and separate; own cell states | horizontal grid/overflow plus responsive controls | P1 | POLISH |
| Employees | `/employees` | registry | filters, raw employee table, mobile cards, pagination | global | raw table + separate mobile markup | explicit mobile card list | P1 | MIGRATE |
| Employees | `/employees/new` | creation/edit form | employee form fields | global | thin page and inline/local states | global form rules | P2 | MIGRATE |
| Employees | `/employees/[id]` | entity detail/workspace | profile, assignments, availability, substitution, history | global | largest domain page (1 104); many inline styles, raw selects, native confirm | mostly stacked cards; bespoke | P0 | MIGRATE |
| Employees | `/employees/reserve` | registry | candidate/reserve wrapper | global + candidate feature | 6-line wrapper; presentation split from page | inherited | P2 | POLISH |
| Candidates | `/candidates` | registry | candidate registry | global + candidate feature | thin wrapper; own loading/error/empty | feature-owned | P2 | POLISH |
| Candidates | `/candidates/new` | creation/edit form | candidate form | global | local form states | global form rules | P2 | POLISH |
| Candidates | `/candidates/[id]` | entity detail/workspace | candidate profile/actions | global | 536-line detail; native confirm | stacked detail | P1 | POLISH |
| Counterparties | `/counterparties` | registry | registry table, pagination | global | raw table; local table implementation | horizontal overflow | P1 | POLISH |
| Counterparties | `/counterparties/new` | creation/edit form | counterparty form | global | local form implementation | global form rules | P2 | POLISH |
| Counterparties | `/counterparties/[id]` | entity detail/workspace | card/edit/archive actions | global | 474-line page; native confirm | stacked | P1 | POLISH |
| Inventory | `/inventory` | registry | raw inventory table, actions | global + inventory feature | inline styles, local states; raw table | horizontal overflow; no separate mobile card/list | P1 | MIGRATE |
| Inventory | `/inventory/new` | creation/edit form | inventory item form | global + feature | thin wrapper | feature-owned | P2 | MIGRATE |
| Inventory | `/inventory/[id]` | entity detail/workspace | item detail, movements, scope | global + feature | 688-line page; inline styles/raw select | stacked panels | P1 | MIGRATE |
| Inventory | `/inventory/movements` | registry | movement list/form | global + feature | raw selects and local loading/error | wide list/overflow | P1 | MIGRATE |
| Inventory | `/inventory/reports` | dashboard | report summary | global | inline styles; local state | single column | P2 | MIGRATE |
| Equipment | `/equipment` | registry | stacked equipment card list (`EquipmentListTable`) | global + equipment feature | component name says Table, rendered UI is cards | stacked cards | P1 | MIGRATE |
| Equipment | `/equipment/new` | creation/edit form | equipment form | global + feature | inline styles; local error | form grid responsive | P1 | MIGRATE |
| Equipment | `/equipment/[id]` | entity detail/workspace | card, movement panel, scope panel | global + feature | local states and confirmation flow | stacked panels | P1 | MIGRATE |
| Accountability | `/accountability` | entity detail/workspace | account panel, expense form | global + accountability feature | 570-line page; many inline styles/raw select | stacked cards/forms | P0 | REDESIGN |
| Accountability | `/accountability/queue` | queue | queue summary/list | `queue.module.css` | compact one-off CSS and badge shapes | explicit 760px breakpoint | P0 | REDESIGN |
| Approvals | `/approvals` | queue | approval cards/filters/actions | global | local approval states and duplicate notice patterns | stacked cards | P0 | REDESIGN |
| Chats | `/chats` | communication | chat list, thread, composer, members, drawers | global + `topbar-communication.css` | 2 502-line monolith; many native dialogs and bespoke states | custom responsive chat layout | P0 | REDESIGN |
| Files | `/files/[fileId]/view` | utility | file preview/viewer | global | local viewer/loading/error states | viewer-specific | P2 | POLISH |
| Settings | `/settings` | utility | settings wrapper/content | global | 16-line thin page | inherited shell | P1 | POLISH |
| Absences | `/user-absences` | registry | absence list/edit form | `user-absences.module.css` + global | miniaturized one-line CSS module; native confirm; raw select | toolbar/editor/list styles include responsive rules | P1 | POLISH |

Примечание: `/` — технический redirect, не самостоятельный пользовательский экран.

## Repeated UI patterns

- `PageTitle`/page header: используется во многих route wrappers, но рядом встречаются локальные `h1`, `intro`, `header`, `section-header`.
- Surfaces: `.page-card`, `.record-card`, `.workspace-surface`, `.hero-card`, `.panel`, `.summary`, object-specific surface classes. Семантически близкие containers имеют разные radius, padding, border and shadow rules.
- Tables: registry tables для objects, employees, counterparties, orders, tasks, inventory; feature tables для timesheet/workforce/calendar. Есть 13 raw `<table>` implementations; equipment uses a stacked card list despite the `EquipmentListTable` name. Mobile markup variants exist only in the screens that explicitly implement them.
- Filters: object/task/timesheet filters, employee query filters, month picker, ad-hoc selects. Нет единого filter-bar contract.
- Tabs/sections: detail workspaces используют section headers, link/action tabs and panels; отдельный универсальный tab primitive не обнаружен.
- Forms: многочисленные label/input/select/textarea blocks; есть reusable `SearchableSelect`, `UserSearchSelect`, employee fields and domain forms, но layout/validation/error rendering повторяются локально.
- Dialogs/drawers: object preview drawer, leadership preview drawer, global command modal, media picker; подтверждения часто browser-native.
- Alerts/notices: `.inline-notice`, `.form-error`, `.notice`, local red/yellow cards and page-card error blocks.
- Status badges: `.ui-badge*`, feature `.badge`, status-specific classes, inline color choices and presentation helpers.
- Pagination: встречается в registry/list pages, но shared pagination primitive не обнаружен.
- Empty/loading/error: почти каждый data screen держит собственные boolean/string states and copy; единый async-state component не обнаружен.

## Browser-native interactions

Найдены 14 файлов с `window.confirm`/`window.prompt`:

- `features/one-time-order-tasks/ui/one-time-order-tasks-panel.tsx` — confirm создания связанной задачи.
- `features/one-time-order-calendar/ui/one-time-order-calendar.tsx` — confirm отмены записи.
- `features/one-time-order-specification/ui/one-time-order-specification-panel.tsx` — confirm действий/удаления пункта ТЗ.
- `features/one-time-order-review/ui/one-time-order-review-panel.tsx` — confirm очистки отзыва.
- `features/task-result/ui/task-result-panel.tsx` — confirm отмены отметки выполнения.
- `features/one-time-order-photos/ui/one-time-order-photos-panel.tsx` — confirm удаления фото + prompt причины.
- `app/(app)/employees/[id]/page.tsx` — confirm архивации сотрудника.
- `app/(app)/user-absences/page.tsx` — confirm удаления отсутствия.
- `app/(app)/candidates/[id]/page.tsx` — confirm архивации кандидата.
- `app/(app)/chats/page.tsx` — confirm выхода/закрытия чата.
- `app/(app)/counterparties/[id]/page.tsx` — confirm архивации контрагента.
- `app/(app)/tasks/[id]/page.tsx` — prompt причины и confirm удаления исполнителя/отмены задачи/сброса результата.
- `app/(app)/one-time-orders/new/page.tsx` — confirmation flow заказа.
- `app/(app)/one-time-orders/[id]/page.tsx` — confirmation flow заказа.

Количество вызовов может быть больше количества файлов: native interaction scattered across route and feature layers.

## Legacy visual tokens/colors

- `app/globals.css` содержит старую blue system: `--primary: #1d4ed8`, `--primary-strong`, `--primary-soft`, blue gradients, blue focus rings and blue surfaces; найдено около 42 blue-related hits в source.
- `shared/styles/design-tokens.css` вводит новую neutral/warm system: `--ui-accent: #5f4b3f`, warm surfaces, semantic colors and shadow tokens.
- В feature/dashboard CSS часто hard-coded warm colors (`#312d2a`, `#8b827b`, `#fffdfb`, etc.) вместо `--ui-*`, поэтому даже новый слой не полностью tokenized.
- `user-avatar.tsx` содержит собственный массив из 10 hard-coded ярких цветов, не связанный с semantic palette.
- Градиенты найдены прежде всего в `globals.css`, `ui-foundation.css`, leadership/dashboard styles and command surfaces. Это несколько визуальных dialects, а не одна token-driven implementation.
- Найдено 57 деклараций radius > 12px; значительная часть — intentional pill (`999px`), но также есть 13/14/16/18px surfaces, расходящиеся с базовыми radius tokens.
- Shadows определены и в globals (`shadow-sm/md`), и в design tokens (`popover/dialog`), и локально в CSS; встречаются heavy popover/dialog shadows.

## Inline-style hotspots

Inline styles найдены минимум в 10 файлах; наиболее концентрированные зоны:

- `app/(app)/employees/[id]/page.tsx` — profile/detail states, action rows, grids, text sizes, min-height/padding, hard-coded red error color.
- `features/accountability/ui/accountability-account-panel.tsx` и `accountability-expense-form.tsx` — card layouts, warning/error backgrounds, labels, textarea and spacing.
- `features/object-edit/ui/object-edit-panel.tsx` — практически вся edit form geometry and raw select styling.
- `app/(app)/inventory/[id]/page.tsx`, `inventory/page.tsx`, `inventory/reports/page.tsx` — cards, errors and grids.
- `features/equipment-form/ui/equipment-form.tsx` — repeated grid/gap and hard-coded error color.
- `features/one-time-order-history/ui/one-time-order-history-list.tsx` — row/card spacing and typography.

Inline styles повторяют gap/padding/display-grid и bypass CSS Modules/tokens; это не бизнес-логика, но затрудняет consistent UI architecture.

## Oversized components/pages

Top source files by lines:

| Lines | File | Observation |
|---:|---|---|
| 2 502 | `app/(app)/chats/page.tsx` | communication shell, list, thread, composer, members and dialogs in one route component |
| 1 104 | `app/(app)/employees/[id]/page.tsx` | profile plus assignments, availability, substitution, history and destructive actions |
| 728 | `app/(app)/one-time-orders/[id]/page.tsx` | detail workspace and many domain panels/actions |
| 688 | `app/(app)/inventory/[id]/page.tsx` | item detail, movement and scope UI |
| 643 | `app/(app)/objects/new/page.tsx` | creation form with local field and option logic |
| 570 | `app/(app)/accountability/page.tsx` | account workspace and expense flow |
| 565 | `app/(app)/objects/[id]/page.tsx` | object workspace composition |
| 536 | `app/(app)/candidates/[id]/page.tsx` | candidate detail/actions |
| 534 | `app/(app)/objects/page.tsx` | registry orchestration |
| 4853 | `app/globals.css` | global stylesheet and legacy/domain rules mixed together |

## Existing reusable components

Reusable/shared candidates already present: `AppShell`, `AppHeader`, `AppSidebar`, `NavLink`, `PageTitle`, `Foundation`, `GlobalCommand`, `GlobalCreateMenu`, `SearchableSelect`, `UserSearchSelect`, `MonthPeriodPicker`, `UserAvatar`, `MediaActionPicker`, `PendingMediaList`, `AttachmentPreviewList`, `EntityFilesPanel`, plus domain feature panels for object/order/task/timesheet/inventory/equipment/accountability.

Важное различие: domain panels are reusable within a bounded context, while their visual primitives often remain local. `dashboard-primitives.tsx` is closest to a genuine local primitive set; object surfaces and global classes are reusable by convention rather than a stable API.

## Missing shared primitives

Фактически отсутствуют или не имеют единого contract:

- `AsyncState`/`DataState` для loading, error, not-found and empty.
- Standard `PageHeader` combining title, subtitle, breadcrumbs, filters and actions.
- `Surface/Card` variants with tokenized density/radius and semantic sections.
- `Button`, `IconButton`, `LinkButton` and destructive-action variants as React primitives (сейчас много global class/raw button/inline variants).
- `Field`, `FormGrid`, `FieldError`, `FormActions` and consistent select/textarea wrappers.
- `DataTable`/`MobileList` with shared columns, responsive strategy, row states and pagination.
- `FilterBar`, filter chip and query-state synchronization primitives.
- `StatusBadge` with canonical semantic mapping.
- `Dialog`/`ConfirmDialog`/`PromptDialog` replacing browser-native interactions.
- `Drawer`/`PreviewDrawer` contract shared by object and dashboard previews.
- `Notice/Alert` variants and error copy boundary.
- Empty state and not-found state with consistent action affordance.
- `Tabs`/workspace navigation and section disclosure primitive.
- Loading skeleton/spinner conventions.

## Suggested architecture input

Следующий UI architect должен учесть следующие факты текущей реализации:

1. Shell is already a meaningful shared boundary; navigation labels and permission-aware visibility live in `AppSidebar`, while search/create/notification/profile actions live in `AppHeader`.
2. There are two active visual foundations: legacy blue globals and newer warm neutral tokens. Migration impact must be mapped before introducing another token layer.
3. Dashboard primitives, object registry/detail, login and shell provide existing implementation references; they should be compared as code contracts, not replaced by an assumed new design.
4. Registry screens have different responsive contracts: some render a second mobile list, some retain tables, some defer to feature components. This is an architectural decision point for table/list primitives.
5. Detail screens are panel workspaces with repeated object/order/task/accountability patterns; panel composition and section headers are recurring boundaries.
6. Form composition is fragmented between route pages, feature forms, global classes, CSS Modules and inline styles. A future architecture needs to preserve domain-specific fields while centralizing layout/error/action primitives.
7. Browser-native confirm/prompt is spread across destructive and reason-required flows and should be treated as an interaction inventory, not silently replaced while changing business behavior.
8. Loading/error/empty/not-found copy and state ownership are local in most modules. A shared async-state contract must avoid changing backend semantics or access rules.
9. `globals.css` mixes tokens, shell, controls, tables, domain selectors and responsive overrides; extraction boundaries should be established from actual usage before deleting legacy selectors.
10. Domain vocabulary must remain aligned with canonical product terms: object comments are not chats; staffing, attendance and timesheet are separate; employee is not user; `responsible` and `manager` are assignments, not system roles.
11. Sensitive actions currently surface through local confirmations and approval-related UI. Any future primitive work must preserve existing approval/access distinctions and must not infer new permissions from visual grouping.
12. Oversized route components, especially chats and employee detail, are both visual and ownership hotspots: their decomposition should be an implementation concern after the architectural inventory, not a reason to alter business logic in this audit.
