# Service Ops Component Contracts

## Contract boundaries

Основа: [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md); применение: [MODULE_ROADMAP.md](MODULE_ROADMAP.md). Ниже — концептуальный API для реализации, не требование конкретной библиотеки. Размеры, tokens, responsive thresholds и action hierarchy наследуются из Architecture. Components принимают данные/callbacks, не делают domain fetch, не назначают роли, не вычисляют финансовые итоги и не разрешают действия.

Точечное уточнение inventory: `shared/ui/foundation/foundation.tsx` уже экспортирует Button, IconButton, Badge, Surface, EmptyState, Skeleton, Tooltip. В UI_AUDIT они не все распознаны как самостоятельные primitives. Это причина EXTEND существующего foundation, а не создания дубля. Сам audit сохраняется без правок.

KEEP — сохранить поведение/API; EXTEND — совместимо расширить; REPLACE — заменить конкретную legacy implementation постепенно; NEW — отсутствует самостоятельный общий contract. Имена здесь обозначают ответственность; re-export или wrapper допустим, rename-only rewrite не нужен.

## Disposition of current components

| Current | Decision | Target / condition |
|---|---|---|
| AppShell, AppShellClient, AppSidebar, AppHeader, NavLink | KEEP | Сохранить layout, permissions, rail, global actions; только точечная интеграция shared controls |
| LoginForm | KEEP | Сохранить flow/password toggle/error; токенизация лишь при локальном polish |
| PageTitle | EXTEND | PageHeader-композиция; прежний `title` API остаётся валиден |
| foundation Button, IconButton | EXTEND | pending/quiet danger/touch semantics, не второй button kit |
| foundation Surface | EXTEND | padding, as, role-safe composition |
| foundation Badge | EXTEND | StatusBadge adapter, compact radius; не глобальный резкий reset существующих badges |
| foundation EmptyState, Skeleton | EXTEND | filter-empty/busy host и однотонная skeleton treatment |
| foundation Tooltip | EXTEND | Escape dismiss, viewport bounds; сохранять keyboard label, не помещать интерактивные controls внутрь |
| SearchableSelect | EXTEND | id, label/error association, verified keyboard/listbox behavior; сохранить async/cache semantics |
| UserSearchSelect | KEEP | User-specific selection adapter; не заменять employee selection, не делать новый enum ролей |
| MonthPeriodPicker | KEEP | Период матрицы; проверить token/focus/touch при Wave 3 |
| UserAvatar | KEEP | Stable identity; при миграции palette брать из same token family, не менять identity calculation |
| GlobalCommand / GlobalCreateMenu | KEEP | Search/create capability scope и shortcuts сохраняются |
| MediaActionPicker, PendingMediaList, AttachmentPreviewList, EntityFilesPanel | KEEP | Existing upload/preview/category behavior; расширять presentation только по необходимости |
| NotificationBell | KEEP | Existing unread/read behavior, унифицировать trigger/popover без новых событий |
| Dashboard primitives | KEEP | Domain summary/rows остаются в dashboard, не превращать в generic framework |
| Object preview / leadership preview drawers | EXTEND | Подключить общую Drawer оболочку по одному, сохранить domain contents |
| Object state panels | EXTEND | Делегировать EmptyState/Skeleton/Alert, сохранить per-section loading |
| Browser-native confirms/prompts, duplicate custom modal shells | REPLACE | ConfirmDialog/ReasonDialog, модуль за модулем, 14 source files из audit |
| Raw form/table/notice styling | REPLACE | Shared Field/DataTable/Alert в migrated module; semantic table/select допустимы внутри primitive |

## Shared behavior

Все props ниже поддерживают accessible native attributes, ref и className для layout, но className не разрешает переопределять semantic colors/geometry. Controlled value/open/selection предпочтительны для URL-backed state. `onSubmit`/`onConfirm` может вернуть Promise; pending/error управляются единственным owner, не одновременно wrapper и parent. Permission filtering выполняет domain owner до передачи actions.

Desktop и medium используют геометрию Architecture; mobile ≤760px и touch расширяют hit targets до 44px. Static surface не имеет shadow. Shared primitives не импортируют `entities/*` или feature panels. Presentation helpers переводят enums в label/tone; API types не проникают в generic components.

## Headers and surfaces

### PageHeader — EXTEND PageTitle

- Responsibility/use: заголовок route, описание и actions; registry, queue, create page. Не использовать как повторный заголовок каждой карточки.
- Variants/API: `title`, `description?`, `backLink?`, `primaryAction?`, `secondaryAction?`, `overflow?`; default/compact. Existing PageTitle может стать title-slot без изменения старых вызовов.
- Interaction: header не кликабелен; action slots соблюдают 1+1+overflow. Loading action сохраняет место.
- Responsive: actions переносятся под текст, title wrap. Reference Objects может сохранить title в shell вместо дублирования.
- Accessibility: один h1 у route, back — anchor с понятным названием. Пример: «Расходники» + LinkButton «Добавить позицию».

### EntityHeader — NEW composition

- Responsibility/use: identity/status/next action существующей сущности. Не summary-grid и не форма всех её полей.
- Variants/API: `title`, `subtitle?`, `status?`, `backLink`, `primaryAction?`, `secondaryAction?`, `overflow?`; regular/compact. Business number допустим в subtitle, UUID нет.
- Interaction: выбор primary делает domain mapping state+capabilities; destructive только overflow. Title не копируется как UUID по клику.
- Responsive: status после title, actions второй строкой; secondary переносится, не исчезает без альтернативы.
- Accessibility/example: h1, status читается текстом; «Поломоечная машина · ИН-024» / «Выдать».

### Surface — EXTEND existing

- Responsibility/use: единая граница области; table/form/panel. Не добавлять вокруг каждого поля и строки.
- Variants/API: сохранить `tone=default|subtle|inset`; добавить `padding=none|compact|normal`, `as=div|section`. Floating tone не выдаёт modal behavior: elevation выбирает overlay owner.
- Interaction: inert container, no hover elevation/clickable whole card by default.
- Responsive: width 100%, min-width:0; padding по Architecture, overflow задаёт table/overlay, не Surface.
- Accessibility/example: section только с accessible heading; DataTable внутри Surface padding=none.

### Section — NEW lightweight composition

- Responsibility/use: именованная группа workspace/form; не отдельный route header.
- Variants/API: `title`, `description?`, `action?`, `children`, `headingLevel=2|3`, `divider?`; plain/inset. Не новый Card clone.
- Interaction: optional action локальная; не сворачивать по умолчанию обязательные поля.
- Responsive: title/action wrap; content определяется children.
- Accessibility/example: h2 и aria-labelledby при landmark; «Назначения» + «Добавить назначение».

## Actions

### Button — EXTEND foundation

- Responsibility/use: действие/submit; не navigation.
- Variants/API: сохранить `variant=default|primary|ghost|danger`, `size=sm|md|lg`, `fullWidth`; добавить `pending`, `pendingLabel?`, `tone=neutral|danger` для quiet danger. Semantic secondary = default, quiet = ghost; не переименовывать API ради терминов.
- Interaction: type=button default; явный submit у формы; pending исключает double invocation и сохраняет label/ширину; danger fill только в confirmation.
- Responsive: 36px default, 44px touch; fullWidth по layout, не автоматически у всех buttons.
- Accessibility/example: native disabled, aria-busy pending, reason рядом; «Сохранить расход».

### LinkButton — NEW adapter

- Responsibility/use: navigation с button appearance, например Create route. Не mutation/onClick-submit.
- Variants/API: `href`, default/primary/ghost, size; переиспользовать Button style recipe, без button внутри anchor.
- Interaction: сохранить browser link semantics, modifier click/open new tab. Недоступный link не рендерить как действующий href.
- Responsive/accessibility: как Button, accessible text; пример `/inventory/new` «Добавить позицию».

### IconButton — EXTEND foundation

- Responsibility/use: общеизвестное compact action (close, overflow, clear). Не единственная неочевидная primary operation.
- Variants/API: existing required `aria-label`, `icon`, `pending?`, `tone?`; quiet/default.
- Interaction: tooltip дополнительный, Escape не запускает click; destructive ведёт в confirmation.
- Responsive/accessibility: 36px visual, 44px touch target, visible focus; «Очистить поиск».

### OverflowMenu — NEW

- Responsibility/use: редкие contextual actions. Не скрывать необходимый шаг ежедневной операции.
- Variants/API: `items[{key,label,href?|onSelect?,tone?,disabled?,disabledReason?}]`, groups/dividers, `triggerLabel`; anchored default.
- Interaction: выбор закрывает menu перед открытием dialog; danger group последняя; отсутствующие permissions = нет item. Placement ограничен viewport.
- Responsive: anchored menu на mobile, не submenu; длинная форма открывает Drawer.
- Accessibility/example: menu button expanded/controls, keyboard arrows/Home/End/Escape, return focus; «Редактировать / Переместить / Списать / Удалить ошибочную запись» для equipment по capabilities.

## Search and filters

### SearchField — NEW wrapper over input

- Responsibility/use: search collection; не asynchronous entity picker (для него SearchableSelect).
- Variants/API: `value`, `onChange`, `label`, `placeholder?`, `onClear`, `busy?`; compact/default.
- Interaction: parent debounce 300ms и URL sync, IME composition не отправляет промежуточный запрос; clear сохраняет focus.
- Responsive/accessibility: full-width mobile, input type=search с label, clear aria-label; «Поиск расходников».

### FilterBar — NEW composition

- Responsibility/use: applied filter state + advanced editing. RegistryToolbar — его usage pattern, не отдельный kit.
- Variants/API: `search?`, `primaryFilters` (≤2), `advancedContent?`, `appliedChips`, `advancedCount`, `onApply`, `onReset`; registry/queue/matrix density. Domain владеет query parsing.
- Interaction: primary immediate, advanced draft с apply; reset оставляет scoped chip до явного снятия. Нет advanced toggle без content.
- Responsive/accessibility: desktop Popover, mobile Drawer; search отдельно; accessible form/region label, focus returns на «Фильтры». Пример Inventory status/category + advanced sorting если поддерживается.

### FilterChip — NEW

- Responsibility/use: видимое applied condition; не status и не decorative tag.
- Variants/API: `label`, `valueLabel`, `onRemove?`, `scope=false`; removable/locked-scope.
- Interaction: remove изменяет query, не открывает entity; tooltip может раскрыть длинное значение, label остаётся доступным.
- Responsive/accessibility: wrapping; отдельная remove button с label «Убрать фильтр …», touch 44px; «Объект: Склад Север».

## Collections and feedback

### DataTable — NEW, keep domain adapters

- Responsibility/use: сравнение записей; не editable timesheet и не chat messages.
- Variants/API: `rows`, `rowKey`, `columns[{key,header,render,align,sortKey?,width?,primary?}]`, `rowHref?`, `rowActions?`, `sort?`, `onSort?`, `loading`, `error?`, `empty`, `mobileMode=scroll|list`, `renderMobileRow?`; dense default. No fetch/business sort inside.
- Interaction: real anchor identity; row click ignores selection/interactive descendants; sticky header; `onSort` только для разрешённого ключа. Mobile list обязателен при mobileMode=list, не автогенерация по DOM.
- Responsive: scroll container для stock/ledger; list для выбранных roadmap modules; no duplicate accessible DOM.
- Accessibility/example: table/caption/th scope, aria-sort на th, labelled keyboard-scroll region; каталог расходников с qty/unit в одной колонке.

### StatusBadge — EXTEND Badge via adapter

- Responsibility/use: сравнимое lifecycle/exception state; не должность, сумма или дата.
- Variants/API: `label`, `tone=neutral|accent|info|success|warning|danger`, `emphasis=subtle|prominent|muted`, `icon?`; использовать existing Badge tones, radius xs в migrated usage.
- Interaction: не clickable; фильтр отдельный. Helper mapping владеет raw enum, unknown fallback без утечки кода.
- Responsive/accessibility: text wrap при нужде, цвет дополняет текст; «Ожидает решения» warning, «Архив» muted.

### Tabs — NEW, separate navigation mode

- Responsibility/use: несколько content areas одной сущности; не filters и не якорная navigation Objects.
- Variants/API: `items[{id,label,count?}]`, `value`, `onChange`, `panels`; content mode. Route navigation mode использует `href` и обычный nav, не tab roles.
- Interaction: owner URL sync и dirty draft guard; manual keyboard activation; не remount dirty form при каждой смене.
- Responsive/accessibility: horizontal scroll, active tab виден; tablist/tab/tabpanel only content mode, aria-selected/controls; Orders «Обзор / Работы / Команда …».

### Alert — NEW

- Responsibility/use: ошибка/предупреждение/результат действия. Не пустой список и не status каждой строки.
- Variants/API: `tone=info|success|warning|danger`, `title?`, `children`, `action?`, `dismiss?`; inline/section.
- Interaction: retry callback только там, где повтор безопасен; server message humanized в domain boundary.
- Responsive/accessibility: action wrap, alert для blocking failure, status для success; не переобъявлять статичное при render. «Не удалось загрузить движения» + «Повторить».

### EmptyState — EXTEND foundation

- Responsibility/use: collection/filter/not-found/forbidden state. Не заменять error или loading.
- Variants/API: сохранить title/description/action; `kind=collection|filtered|not-found|forbidden`, `compact?`. Plain/inset без декоративной dashed card по умолчанию в таблице.
- Interaction: Create только при permission, filtered → Reset; forbidden не предлагает Create.
- Responsive/accessibility: текст и button доступны в обычном flow; «По заданным условиям позиций нет» + «Сбросить фильтры».

### Skeleton — EXTEND foundation

- Responsibility/use: structural initial loading; не indefinitely вместо error.
- Variants/API: existing width/height, `shape=line|control|row|block`; compositions в domain adapter, не giant универсальный loading page.
- Interaction: no focus/events; host aria-busy, один loading announcement; flat muted background без gradient/shimmer.
- Responsive/accessibility: повторяет реальный layout; aria-hidden; 5 строк inventory table на initial request.

### Pagination — NEW

- Responsibility/use: навигация по реально известным страницам; не infinite chat history.
- Variants/API: `page`, `pageSize`, `total`, `onPageChange`, `pending?`; compact/default. Если API не даёт total — отдельный next/previous режим с `hasNext`, не выдумывать count.
- Interaction: query сохранён; после filter reset первая page; zero показывает 0, не «1–0». Out-of-range после удаления корректируется по ответу.
- Responsive/accessibility: счётчик переносится, prev/next остаются; nav label, current page announced; «26–50 из 120».

## Overlays

### Dialog — NEW internal base

- Responsibility/use: focus/modal mechanics для короткой задачи. Не detail workspace.
- Variants/API: `open`, `onOpenChange`, `title`, `description?`, `initialFocus`, `returnFocus`, `busy`, `children`, `footer`; standard 560px, compact 420px.
- Interaction/responsive: trap/inert/scroll-lock, Escape/close согласно Architecture; mobile viewport−24px; dirty guard. No mutation itself.
- Accessibility/example: role=dialog, aria-modal, labelled title; краткая форма выдачи денег.

### ConfirmDialog — NEW on Dialog

- Responsibility/use: подтвердить последствия. Не спрашивать причину (ReasonDialog), не подтверждать каждый harmless click.
- Variants/API: `title`, `consequence`, `confirmLabel`, `tone=neutral|danger`, `onConfirm`, `pending`, `error`; no hidden callbacks on close.
- Interaction: Cancel initial focus для danger, await success; failure сохраняет dialog, не navigate away. Existing operation unchanged.
- Responsive/accessibility: base Dialog, buttons 44px touch; «Удалить ошибочную запись оборудования?» с разъяснением blockers.

### ReasonDialog — NEW on Dialog

- Responsibility/use: операция уже требует комментарий по contract/runtime; не вводить обязательную причину произвольно.
- Variants/API: ConfirmDialog context + `reason`, `onReasonChange`, `reasonLabel`, `required`, existing `validate`, `onConfirm(reason)`; warning/danger.
- Interaction: сохранение ввода при failure; validate before callback, focus first invalid; no automatic mutation retry.
- Responsive/accessibility: Field textarea, keyboard-safe footer, error association; «Отклонить согласование» + причина.

### Drawer — NEW shared shell, EXTEND existing adapters

- Responsibility/use: contextual preview/review/short edit. Не full creation wizard и не permanent desktop split pane.
- Variants/API: `open`, `onClose`, `title`, `size=preview|review`, `children`, `footer?`, `dirty?`, `busy?`; modal overlay только. Inline inspector использует Surface/Section с тем же domain detail child.
- Interaction: base modal lifecycle, parent retains selection/query/scroll; nested ReasonDialog suspends parent trap. Закрытие возвращает trigger, после удаления — ближайший доступный item.
- Responsive/accessibility: 480/640px, mobile full viewport; labelled dialog, Escape/close; ApprovalDetail в Drawer без N+1 загрузки каждого row.

### Popover — NEW shared positioning shell

- Responsibility/use: advanced filters/короткий picker. Не reason-required operation.
- Variants/API: `trigger`, `open`, `onOpenChange`, `content`, `placement`; меню использует OverflowMenu, произвольная форма не получает role=menu.
- Interaction: outside click/Escape close; не применять filter draft автоматически; clamp/flip у края viewport.
- Responsive/accessibility: FilterBar заменяет его Drawer на mobile; focus management по content, не blanket trap всех tooltips. Пример «Фильтры» реестра.

## Forms

### Field — NEW wrapper, retain native input/select

- Responsibility/use: label/help/error association и единая control styling. Не domain picker/data fetch.
- Variants/API: `id`, `label`, `required`, `help?`, `error?`, `disabledReason?`, `children`; input/select/textarea remain native or existing SearchableSelect with forwarded IDs.
- Interaction: error после blur/submit owner; native select не заменять custom dropdown без необходимости поиска.
- Responsive/accessibility: full-width, label for, aria-invalid/describedby, no placeholder-only; «Количество, л».

### FormGrid — NEW layout

- Responsibility/use: field arrangement. Не page grid/financial ledger.
- Variants/API: `columns=1|2`, child `span=1|full`; default 2, gap16, section gap24 через Section.
- Interaction: нет; DOM order совпадает с reading order, не CSS reorder полей.
- Responsive/accessibility: 1 колонка при available width <640px, no redundant role; title/address full-span в Object form.

### FormActions — NEW composition

- Responsibility/use: Save/Cancel в одном месте. Не набор lifecycle controls.
- Variants/API: `submitLabel`, `pending`, `onCancel`, `disabledReason?`, `sticky=false`; inline/sticky.
- Interaction: submit через form, cancel сохраняет existing navigation semantics и dirty guard; no destructive button рядом с Save.
- Responsive/accessibility: mobile sticky только для длинной формы с reserved bottom space; не перекрывает keyboard/focus. Пример «Сохранить / Отмена» Employee edit.

## Domain-owned compositions, not new shared kits

EntitySummary, QueueRow, ApprovalDetail, Ledger, MatrixInspector и ChatMessage — feature components с использованием Surface, Section, StatusBadge, Field и actions. Они не обобщаются в giant configurable widget. Разделение presentation и effects не меняет lifecycle запросов, загрузки attachments, realtime или порядок mutations.

## Implementation acceptance

В каждом module PR перечислить используемые primitives и заменённые legacy consumers; убедиться, что KEEP не переписан без необходимости. Unit tests — meaningful interaction/state transitions, не зеркальные snapshot tests каждого div. Проверять keyboard, touch, focus return, failure/pending, links и query Back; визуальные размеры сверять с Architecture. Проверки далее выполняются локально и в scoped объёме, без требования массового frontend rewrite.
