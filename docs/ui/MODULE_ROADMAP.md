# Service Ops Module Roadmap

## Scope and reading rules

Источник current facts — [UI_AUDIT.md](UI_AUDIT.md), точечные реализации HEAD `1e8c28a`. Target rules — [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md), компоненты — [COMPONENT_CONTRACTS.md](COMPONENT_CONTRACTS.md). Это план реализации, не изменения runtime. Приоритет P0/P1/P2 — величина долга, REFERENCE/MIGRATE/REDESIGN/POLISH — характер работы; высокий риск может отложить P0 до готовности компонентов.

Для всех модулей: действия ниже доступны только при existing capabilities; primary может отсутствовать, если разрешённых операций нет. Не добавлять permissions, endpoints, search/sort, bulk actions, экспорт или суммы только потому, что они удобны в target layout. Локальные filter/sort допускаются для полного уже полученного набора; server-paginated набор нельзя сортировать только в пределах страницы и выдавать за весь реестр. Неизвестные/неполные данные обозначаются явно. Фильтры, формы и dialogs подчинены общему контракту, модуль задаёт только domain fields.

## Coverage of existing routes

Таблица покрывает все 41 `(app)` route, login и root redirect; разделы ниже описывают общие и специфичные действия каждого модуля. Новых backend/route requirements здесь нет: equipment types — view существующего `/equipment`, tabs — query state существующих routes.

| Module | Existing routes | Target / status | Priority |
|---|---|---|---|
| Shell/auth | `/`, `/login`; `(app)/layout` | Shell/Login REFERENCE; `/` сохраняет redirect | P2 |
| Dashboard | `/dashboard` | Specialized dashboard, REFERENCE | P2 |
| Objects | `/objects`, `/objects/new`, `/objects/[id]`, `/objects/[id]/edit`, `/objects/[id]/history` | Registry/workspace REFERENCE; create/edit MIGRATE; history POLISH | Registry P2; detail/forms P1 |
| Approvals | `/approvals` | Queue REDESIGN | P0 |
| Accountability | `/accountability`, `/accountability/queue` | Financial workspace/Queue REDESIGN | P0 |
| Inventory | `/inventory`, `/inventory/new`, `/inventory/[id]`, `/inventory/movements`, `/inventory/reports` | Registry/workspace/ledger MIGRATE | P1, new/reports P2 |
| Equipment | `/equipment`, `/equipment/new`, `/equipment/[id]` | Registry/workspace MIGRATE | P1 |
| Orders | `/one-time-orders`, `/one-time-orders/new`, `/one-time-orders/[id]`, `/one-time-orders/[id]/workforce`, `/one-time-orders/calendar`, `/one-time-orders/attention` | Registry/workspace/matrix/queue MIGRATE | P1, calendar P2 |
| Tasks | `/tasks`, `/tasks/new`, `/tasks/[id]` | Registry/workspace MIGRATE | P1, new P2 |
| Employees | `/employees`, `/employees/new`, `/employees/[id]`, `/employees/reserve` | Registry/workspace MIGRATE; reserve candidate view POLISH | Detail P0; registry P1; new/reserve P2 |
| Chats | `/chats` | Communication visual REDESIGN, behavior KEEP | P0 |
| Timesheet | `/timesheet` | Operational Matrix POLISH | P1 |
| Candidates | `/candidates`, `/candidates/new`, `/candidates/[id]` | Registry/workspace POLISH | P2, detail P1 |
| Counterparties | `/counterparties`, `/counterparties/new`, `/counterparties/[id]` | Registry/workspace POLISH | P2 forms, otherwise P1 |
| Absences | `/user-absences` | Registry + inline editor POLISH | P1 |
| Files | `/files/[fileId]/view` | Specialized viewer POLISH | P2 |
| Settings | `/settings` | Utility placeholder hidden from navigation | P1 |

## Shell, Sidebar, Topbar, Login — REFERENCE

- Current/target: existing shared shell, permission-aware sidebar, global search/create/notifications/account menu; login with split presentation. Сохранить navigation, shortcuts, collapsed/expanded state, login flow, error and password visibility.
- Information: основной контекст — текущий модуль/пользователь; secondary — рабочая роль. Не путать route family dashboard с membership leadership circle: текущий router может показывать один dashboard разным ролям, это не новый ACL.
- Actions: login primary «Войти», secondary отсутствует, password toggle quiet. Shell global create/search остаются global; они не дублируют entity primary. Overflow — account menu/logout; filter/table/tabs неприменимы.
- Change/remove: scoped token cleanup при затрагивании; убрать Settings entry из Sidebar, account menu и command navigation в Wave 4 согласованно. Не перестраивать shell.
- Desktop/mobile: сохранить rail 68/236px и mobile58px, topbar56px, скрываемые secondary labels. Login сохраняет существующий responsive split/collapse; hit targets/focus проверить.
- Primitives: KEEP AppShell/NavLink/LoginForm/GlobalCommand/NotificationBell; Button/IconButton/Popover только при адаптации. Risk низкий локально, высокий у глобального CSS cascade. Dependency Wave0; проверка login/logout/search/create/unread и scoped navigation.

## Dashboard — REFERENCE

- Current/target: role router и специализированные leadership/HR/manager/fallback workspaces с compact metrics/rows/previews. Сохранить данные, routing, role-specific sections, existing operational signals and Moscow time semantics.
- Information: prominent — внимание/следующая операция; secondary — объект, ответственный, срок; metadata — updated/date. Primary — contextual link строки, не новая giant CTA всей страницы; secondary «Все …» в section; overflow только там, где уже есть действия.
- Filters/table/tabs: не добавлять общий filter panel/tab system на dashboard; существующие small lists и summary strips остаются. Preview — shared Drawer оболочка по готовности, без расширения данных.
- Change/remove: local token substitution, flat summary, shared pending/error когда section затрагивается; убрать gradient/лишние shadows при этом. Не унифицировать разные роли в один «универсальный dashboard».
- Desktop/mobile: существующие grids сохраняются, mobile stacks; info нельзя терять без доступного detail. Primitives: KEEP dashboard primitives, EXTEND drawers, Alert/EmptyState/Skeleton. Risk средний для deep links/role variants. Dependencies Wave0, rollout необязательный для запуска Wave1.

## Objects — REFERENCE registry/detail; MIGRATE forms

- Current: registry с query/sort/pagination, собственными filters; detail с summary и anchor navigation, operational sections. Create 643 строки; edit/history отдельные routes. Target: сохранить эти layouts как reference, новые primitives интегрировать постепенно.
- Keep: URL-параметры, operational signals, permissions, summary, team/staffing, arrival/report/comments, scope links. Не превращать comments в chat и staffing в attendance.
- Information: identity название+адрес; prominent статус/операционный сигнал, secondary ответственные/менеджеры/численность по доступным данным. Header primary registry «Создать объект»; detail не добавляет выдуманный переход lifecycle: current operational actions остаются в соответствующих sections; secondary «Редактировать» если доступно; overflow история/редкие status management actions.
- Filters/list: сохранить search/status/issue и текущую сортировку; FilterBar заменяет только оболочку. Table identity/address, status/signal, team, workforce — сохранить смысл колонок без новых показателей; mobile existing list. Не менять source/full-set handling issue filters.
- Workspace: сохранить Обзор / Сегодня / Команда / Задачи / Склад / Оборудование / Файлы / История как anchors, не объявлять их Tabs. Create/edit — Field/FormGrid/FormActions поверх existing payload; отдельный history route сохраняет совместимость ссылок.
- Change/remove: inline style edit, raw visual variants ошибок, redundant confirm shells; не переписывать detail в Wave1. Desktop full-width exception сохраняется, mobile sections stack. Primitives: PageHeader adapter, EntityHeader при необходимости, existing object panels + shared state/form primitives.
- Risk: средний, особенно split permissions и manual rate actions. Dependencies: Wave0, scope consumers из Inventory/Equipment. Validation GP-OBJ-001…004 и возврат из edit/history без потери контекста; никакого расширения доступа responsible.

## Approvals — P0 REDESIGN

### Current and target

Сейчас route объединяет filters, cards, решения и technical Source type/id; тип содержит `summary.title/subtitle`, `createdBy`, dates, `payloadSnapshot`, `capabilities.canApprove/canReject/canCancel`. Target — Queue с человеческим предметом решения и одним выбранным detail Drawer. Сохранить existing deep links `sourceEntityType/sourceEntityId`, параметры status/type/dates и те же approve/reject/cancel endpoints.

### Structure and information

QueueRow: первая строка `summary.title`, справа StatusBadge; вторая — `summary.subtitle` и человекочитаемый type; третья — инициатор и дата. Сумма/количество отдельным правым значением только для распознанного typed snapshot поля с единицей/валютой. Нельзя интерпретировать произвольный number как деньги. Summary используется как есть после безопасного presentation fallback; если содержит один технический ID, fallback — «Согласование: <русский тип>», ID в details. Не делать enrichment fetch для каждой строки.

Detail: заголовок предмета → status/author/date → business context → результат/изменение/сумма по доступным полям → evidence, если уже доступно → decision history/comment. Raw payload JSON не выводить автоматически. Optional collapsed «Технические сведения»: request ID, source type/id; не раскрывать новые поля snapshot. Ссылка на entity только по существующей разрешённой связи, при denied/not-found показать explanation, не ретраить с повышенным scope.

Counters: «Ожидают / Подтверждены / Отклонены» только если полный доступный response позволяет их посчитать; иначе counter текущей выборки с такой подписью. Не придумывать глобальные totals. Tabs не нужны: status — filter, не отдельная сущность workspace.

### Actions, filters and responsive

Primary в detail «Подтвердить» при canApprove; secondary «Отклонить» quiet danger открывает ReasonDialog с current requirement; overflow «Отменить запрос» при canCancel с ConfirmDialog. Нет массового approve и ряда одинаково ярких кнопок. Resolved request показывает автора/время/комментарий, actions отсутствуют. Financial sensitive approval показывает существующий предмет и последствия, но не меняет требование подтверждения.

Primary filters status + type; advanced dates. Scoped entity chip из deep link; UUID не пользовательский filter input. Search не выводить, пока не определён корректный поиск по полному доступному набору существующего response. Desktop list + Drawer640, mobile full-width Drawer; focus/scroll возвращаются к строке, после решения обновляется очередь без сброса filters. Primitives: PageHeader, FilterBar/Chip, StatusBadge, Section, Drawer, Button, OverflowMenu, ReasonDialog, ConfirmDialog, Alert, Skeleton, EmptyState.

Remove: Source в primary UI, English `Inventory exception`/`approval request`, постоянно раскрытая reject textarea, inline decoration. Risk высокий: stale decisions и capability transitions. Dependencies Wave0 overlays + presentation mapping. Validate GP-APR paths, pending/resolved/cancelled, rejection reason, duplicated click, permission denied and cross-module deep links; доступ не расширять.

## Accountability — P0 REDESIGN

### Current and target

Current account page содержит own/review/funding и длинные panels; queue имеет собственный CSS Module. Target — финансовый Entity Workspace + Queue review. Держатель account — `user`, не Employee: UI «Подотчёт пользователя»/имя; просьба review сотрудника реализуется как review системного пользователя без связывания Employee.

Сохранить `currentBalance`, `forecastBalance`, funding/credit/debit totals, expense states, closures, links к order/work cycle и existing mutation sequencing. Текущие backend summary authoritative: не вычислять баланс заново из показанных строк и не суммировать разные accounts как один.

### Layout

Header: имя держателя и состояние account. Summary strip: «Текущий остаток», «Прогнозный остаток», «Расходы на проверке» (count, не выдуманная сумма), «Выдано» по existing totals; максимум 4 поля. Рядом короткая подпись смысла current vs forecast согласно existing presentation; не переопределять формулы. Tabs: «Операции», «Расходы», «Сверки». Fundings входят в операции; closures — история попыток сверки, successful closure не означает terminal closed account.

Ledger: Дата / Операция и описание / Автор или источник / Сумма и направление / Состояние / overflow. Credit/debit явно подписаны; status expense отдельно от funding, draft/rejected расход не изображать списанными деньгами. Объединение arrays — presentation view с сохранением source type, IDs и source timestamps, не новая ledger entity. Secondary — author, source order/cycle, evidence. History ties сохраняют стабильный порядок источника.

Reviewer desktop при main≥1040px: слева360 список пользователей (имя, остаток, число ожидающих), справа выбранный account/review content. `/accountability/queue` остаётся deep-linkable очередь, её row открывает тот же account review; состояние выбора/query сохраняется. Medium/mobile — список → Drawer review/full-width; account tabs горизонтальны. Ledger остаётся horizontal table, деньги не скрываются в cards.

### Actions and filters

Owner primary «Добавить расход» при canCreateExpense, secondary «На сверку» при canRequestClosure. Reviewer primary «Выдать средства» при canIssueFunding, secondary отсутствует; review expense actions локально у выбранного расхода, не десятки primary на списке. Approve/reject по capabilities, reject → ReasonDialog. Overflow — доступные редкие действия существующего account, без «Передать подотчёт».

Issue flow: Dialog с зафиксированным/выбранным из existing directory получателем, суммой, existing optional comment; перед submit видны получатель+сумма. Один existing funding request, pending disables повтор; uncertain network result сначала refresh account, не blind resubmit. Расход: description свободным текстом, сумма, attachments; order-specific fields только в соответствующем current flow, не навязывать category enum всему подотчёту.

Filters: reviewer search name только по полному доступному набору, pending/status по available fields; ledger type/status и period локально только если весь ledger загружен. Не показывать неподдерживаемые фильтры как работающие. Remove: card-per-metadata, raw IDs, persistent funding form среди ledger, competing primary buttons.

Primitives: EntityHeader, Surface/Section, Tabs, DataTable(scroll), FilterBar, Field/FormGrid/FormActions, Dialog, ReasonDialog, Drawer, StatusBadge, Alert/EmptyState/Skeleton. Risk высокий: деньги, partial errors/upload and duplicate mutations. Dependencies Wave0 + Approval shared decision shell из Wave1a. Validate GP-EXP-001…003, issuance permissions, closure returns active, linked-order expenses, totals неизменны, uncertain response recovery.

## Inventory — MIGRATE

- Current/target: raw table с horizontal overflow, отдельного mobile card/list нет. Target Registry в языке Objects, не обязательная копия его mobile view. Navigation links «Каталог / Движения / Отчёты» ведут на existing routes; Reports показывать по capability. `/inventory/new` — Create form, `/inventory/[id]` — workspace.
- Keep: soft/hard delete, restore/version handling, numeric source values, movement photos/approvals, sorting/query pagination. Prominent: название, остаток с единицей, inactive state; secondary category, existing price and valuation, movements count в detail.
- Columns: «Номенклатура» (name/category), «Остаток» (qty+unit), «Макс. цена поставки» (сохранить current field meaning), «Оценка», «Состояние», overflow. Не называть price средней ценой; не пересчитывать valuation из округлённого display. Movement count убрать из registry в summary.
- Filters: search + category + active/deleted, остальные existing controls в advanced. Sort только current API keys; label соответствует полю, default сохранить. Deleted остаётся видимым по фильтру, muted badge «Удалена» и дата в detail, не opacity всей строки.
- Actions: registry «Добавить позицию», secondary «Движения» как nav; detail primary «Движение» при canCreateMovement открывает текущую movement form с permitted types, secondary «Редактировать». Overflow «Удалить»/«Восстановить» по current flags. Специальное удаление из исходного UI сохраняет точное различие irreversible vs history-preserving, blockers/version и confirm текст; не изобретать вторую hard-delete кнопку.
- Detail tabs: «Обзор» (catalog + stock), «Движения» (ledger), «Управление» (read-only deletion state/blockers; mutation через overflow). Ledger Дата / Операция / Откуда→куда / Количество / Сумма / Evidence+статус; immutable snapshots не заменять сегодняшней ценой. `/movements` использует тот же renderer/filters, scoped detail сохраняет item scope.
- Desktop:1480 table; mobile horizontal scroll с identity читаемой, не вводить карточки. Forms stack. Reports сохраняет текущие summary values, компактная surface. Remove inline spacing/color, local state styling, permanent deletion panel с яркими кнопками.
- Primitives: PageHeader/EntityHeader, Tabs navigation/content, DataTable(scroll), FilterBar, StatusBadge, Field/FormGrid, ConfirmDialog/ReasonDialog по existing requirements, shared attachments. Risk средний/высокий у deletion/evidence. Dependencies Wave0, Approval detail renderer; validate GP-INV paths, inactive/restore/version conflict, sorting across pages, object-scoped issue, receipts snapshots and missing photo approval.

## Equipment — MIGRATE

- Current: `EquipmentListTable` фактически stacked cards. Target: dense Registry физических единиц + отдельный view «Типы оборудования» в `/equipment?view=types`; не новый backend module. Unit и catalog type — разные сущности, не объединять delete flows.
- Unit columns: «Оборудование» (type name + inventoryNumber), «Марка / модель» (serial secondary), «Местонахождение» (object/order name + kind), «Состояние», overflow. Inventory number prominent, raw unitId hidden. Нет assignment ≠ всегда склад: status и destination выводятся по existing lifecycle/presentation.
- Type columns: Наименование / Категория / Марка и модель / Количество единиц / Активность / permitted actions. Использовать existing catalog endpoint и unitsCount; inactive type не удаляет units. Не рисовать edit/deactivate type если current API не поддерживает операцию.
- Filters: unit search+status, advanced existing object/order scope. Type search/category local лишь по полному catalog. Sorting только поддержанное существующим contract либо полный загруженный array; no fake server pagination. Create page: сначала existing SearchableSelect type, рядом quiet «Добавить тип» только при catalog manage; короткий Dialog создаёт тип current endpoint, выбирает returned item. Failure не теряет unit draft; orphan созданный тип не удалять автоматически.
- Actions state+capability: warehouse→«Выдать»; assigned→«Вернуть»; broken→«Отправить в ремонт»; repair→«Вернуть из ремонта». Secondary «Переместить» если доступно, иначе none. Overflow remaining permitted movement types, edit если поддерживается, «Списать», «Удалить ошибочную запись». Writeoff — lifecycle/approval с evidence, erroneous delete — existing deletionState/blockers и необратимость. Отсутствие canReturn не делает delete primary.
- Workspace tabs «Обзор / Движения»; summary inventory/serial/current assignment/status; attachments остаются у движения, не выдумывать unit-level evidence API. Ledger date/type/from→to/status/evidence. Types navigation не превращать в extra sidebar module.
- Desktop dense table; mobile compact list identity+status+location+overflow, serial/type доступны в detail. Это сознательный будущий переход от current cards. Remove card-per-unit на desktop, англоязычные labels/errors, inline styles. Primitives: DataTable(list), EntityHeader, Tabs, FilterBar, SearchableSelect, Dialog/ConfirmDialog/ReasonDialog, media components. Risk средний/высокий lifecycle. Dependencies Wave0 + Wave1 Inventory ledger/Approval patterns; validate GP-EQP, denied links, broken/repair/writeoff/pending, creation type failure и delete blockers.

## One-time orders — MIGRATE

- Current: registry и длинный vertical detail document 728 строк, формы/workforce/calendar/attention. Target Registry + tabbed Entity Workspace; calendar/workforce остаются Operational Matrix, attention — Queue.
- Registry columns: «Заказ» (title + linked object), «Выполнение» (start–end), «Менеджеры», «Состояние», «Сумма» только по existing financial visibility, overflow. Адрес вторым line/detail, metadata и дополнительные financial figures убрать из отдельных колонок. Не изобретать payment lifecycle «ожидает оплаты».
- Filters: существующий search+status, advanced period/manager только если current contract их поддерживает; calendar сохраняет month/scope selectors. Prominent title/dates/status/next operation; secondary customer/address/linked object/managers, metadata created/author.
- Header primary «Завершить работу» только при соответствующем current permission/state; оно открывает existing completion form, не прямую оплату. Secondary «Редактировать» когда разрешено. Overflow available reopen/date-shift/cancel/other lifecycle actions с existing reason/reset confirmations. Когда primary не разрешена, оставить header без неё; задачи/фото — actions вкладки, а не дополнительные header primaries.
- Exact tabs: **Обзор** — summary, customer/address/linked object, lifecycle/completion/payment/review context; **Работы** — ТЗ, tasks и daily reports; **Команда** — managers + link на existing workforce page; **Расходы и ресурсы** — existing order accountability, inventory movements, equipment scope, раздельные Sections и gates; **Медиа** — photos/categories и existing files; **Комментарии** — object-like order comments, не chats; **История** — current history list. Completion/review/edit формы показывать по action, не постоянно раскрытыми во всех tabs.
- Keep payloads, managers/participants, work cycles, files upload order, visibility and timing conflict rules. Tab state в URL, hidden financial sections не запрашиваются без разрешения; при переносе panels не делать repeated mutation on mount. Форма new сохраняет существующие поля и подтверждения через shared dialogs.
- Desktop summary+single active content, максимум1480; matrix full-width. Mobile scroll tabs, stacked sections, registry compact list, matrix horizontal scroll. Remove wall-of-panels, repeats action rows, native dialogs. Primitives: EntityHeader, Tabs, Section, DataTable(list), FilterBar, ReasonDialog/ConfirmDialog, existing feature panels. Risk высокий: panel lifecycle, payment evidence, date changes. Dependencies Wave1 resource/accountability shells, Wave0 tabs; validate GP-OTO-001…003, tab switching with draft, linked visibility, completion corrections and calendar conflicts.

## Tasks — MIGRATE

- Current registry/filter/form/detail/result panels; native reason prompts и reset confirms. Target Registry + workspace, same task lifecycle. Prominent title/status/deadline/own assignment, secondary object/order and assignees; history IDs not primary.
- Columns: Задача (title+scope) / Исполнители / Срок / Состояние / Приоритет / overflow. Filters existing search/status, advanced assignee/scope/priority только existing support. Keep current sort/due timezone, completionRequirement and requiresConfirmation; не переинтерпретировать UI label как permission close.
- Actions: исполнителю primary «Отметить выполнение» открывает existing result form; authorised reviewer primary «Подтвердить результат» только если current flow позволяет, иначе LinkButton к согласованию. Secondary «Редактировать» при permission; overflow rename/reassign/reopen/cancel/reset operations ровно по current availability. Destructive cancel и reason-required operations через соответствующий dialog; edit triggering reset сохраняет existing warning и `resetCompletions` sequence, не default true.
- Tabs **Обзор** (description, scope, dates/priority), **Исполнители и результаты** (assignments/completions/evidence), **История** (events/reasons). Files остаются при результате/записи, без нового endpoint. Create отдельный current route; long edit существующая форма внутри workspace.
- Desktop table; mobile compact list title/scope/deadline/status, priority/detail остальные. Header1+1+overflow, local result submit не дублируется header button. Remove native prompts и конкурирующие primary actions. Primitives DataTable(list), EntityHeader, Tabs, FormGrid/Field/FormActions, ReasonDialog, ConfirmDialog, attachments. Risk высокий reset/completion. Dependencies Wave0/Approval shell; validate GP-TASK and concurrent edits, multiple assignees, permission checks, reason persistence on error.

## Employees — MIGRATE

- Current registry с desktop table/mobile cards; detail1104 строк с profile/edit/assignments/availability/substitutions/history. Target Registry + workspace; Employee остаётся отдельным от User, login/account flows не добавлять.
- Columns: Сотрудник (name+position) / Контакт / Назначения (object names/count) / Рабочий режим (existing schedule label) / Статус / overflow. Prominent name/employmentStatus/current assignment, secondary phone/position/work conditions; sensitive fields только в existing permitted profile.
- Filters existing name/search+employmentStatus, остальные object/position/work-time/month и existing query filters в advanced. Сохранить async object/position lookups и server pagination, не local filter текущей page. Reserve link остаётся `/employees/reserve` с CandidateRegistry, не convert в Employee registry.
- Header primary «Назначить на объект» при canManageAssignments, secondary «Редактировать» при canEdit. Availability/substitution actions принадлежат своим tabs. Overflow «В архив», «Восстановить», «Полностью удалить» по independent capabilities. Restore archived не разрешает archive active assignment обходом. Irreversible delete и erroneous assignment removal сохраняют reason/version/blockers; unknown blockers human-readable fallback + technical code collapsed.
- Tabs **Профиль** (fields read-only, Edit mode по action), **Назначения** (current + assignment history), **График и доступность** (existing schedule/work-time labels отдельно от dated availability), **Подмены** (role/date/source and create flow), **История** (только имеющиеся history data, не обещать новый audit endpoint). Дублированную assignment history не выводить дважды: History tab может ссылаться на раздел Назначения; если другого history source нет, не показывать пустую вкладку История.
- Не вычислять attendance из availability и не строить новый shift planner. Create/Edit переиспользуют EmployeeFormFields; long edit form вместо постоянно открытых полей профиля. Desktop1480, mobile сохраняет card/list variant, tabs scroll, form1col. Remove inline red states, native archive confirm, repeating nested cards.
- Primitives: EntityHeader/Tabs, DataTable(list), FilterBar, existing selects/fields, FormGrid/FormActions, ReasonDialog/ConfirmDialog. Risk высокий версия/assignments/history; dependencies Wave0, reuse Tasks dialog patterns, independent от нового backend. Validate HR golden paths, view-only deputy access, archive blockers, rate/history unchanged, destructive exact endpoint semantics.

## Chats — P0 visual REDESIGN, functionality KEEP

- Current route2502 строки, realtime/scroll/unread/management and custom modals. Target сохраняет communication layout; не Registry и не Entity Tabs. Desktop room list320px + thread remaining, medium list280px когда помещается, mobile одна pane: rooms → thread с Back; selected room/query сохраняется.
- Prominent: room identity, message author/content, unread marker; secondary sent/edit/read metadata, attachments, reply context. Incoming surface white, own subtle accent, border-first8px; system messages neutral centered, без decorative cards/shadows. Avatar color не означает статус/permission.
- Room list: name / last message / time + compact unread count. Existing search/archive filters оставить, не добавлять global server search capabilities. Own/incoming отличаются alignment/background+author, не только цветом. Unread divider и «Новые сообщения» сохраняют существующую scroll semantics.
- Primary composer «Отправить», secondary attachment button; reply/edit previews перед input, progress/errors у файла. Room header secondary «Участники», overflow existing room management/archive/leave/close operations. Не переносить Send в PageHeader и не менять existing keyboard send convention. Reason-required close через ReasonDialog, leave через ConfirmDialog.
- Boundaries: `ChatRoomList` (search/items/archive), `ChatThreadHeader`, `ChatMessageList` (только presentation плюс forwarded refs), `ChatMessage` (author/text/reactions/forward/reply), `ChatComposer`, `ChatAttachmentList` (reuse media previews где совместимо), `ChatRoomManagement` (dialogs/participants). Route/controller остаётся единственным owner socket subscription, read receipts, message dedup/order, initial-scroll run IDs, pagination and upload mutations. Effects переносить отдельным последующим change с доказанной эквивалентностью, не вместе с visual split.
- Keep message edit window, deletion/forward/reply/reactions, read receipts, archive/rejoin behavior, URL jump and load older history. Remove blue bubbles/gradient/heavy shadow, duplicated modal shells, технические ошибки. Files нельзя свести к plain download если сейчас есть preview.
- Primitives: Surface/Section, SearchField, IconButton/OverflowMenu, Drawer/Dialog/ReasonDialog, Alert/Skeleton/EmptyState; ChatMessage остаётся domain. Risk очень высокий scroll/realtime/keyboard, поэтому Wave3 несмотря на P0. Dependencies стабильные Wave0 overlays/media integration. Validate two clients, live new messages while scrolled up, unread entry, history prepend, jump/reply/edit/forward/reactions, failed upload/retry, reconnect/dedup, leave/close, mobile Back/keyboard; backend/socket protocol untouched.

## Timesheet — POLISH

- Current/target: Operational Matrix, сохранить grid/overview, MonthPeriodPicker, corrections/legend и finalValue. Prominent employee+day amount, selected scope/period; secondary totals Аванс/ЗП/Итого, exception/correction explanation, metadata actor/date.
- Toolbar: object/all available overview selector + month, primary existing export action, secondary existing view switch; редкие allowed actions в overflow, не invent bulk correction. Filters existing scope/period, поиск только если полный список. Matrix numeric cells tabular/right, identity column/date header sticky, horizontal scroll.
- Cell states distinct: selected accent border, automatic neutral, manual correction small marker+label in inspector, pending exception warning, error danger; ноль не пустота. Legend объясняет marker, не duplicate full status badge в каждой cell. Право просмотра не даёт manual edit.
- Inspector Surface/Section справа при main≥1040, иначе Drawer: employee/date, automatic/current/manual source values только доступные из response, reason/history. Correction submit primary «Сохранить корректировку» только current capability; required reason сохранён. Не пересчитывать исторический finalValue по сегодняшней ставке. No tabs required beyond existing overview selection.
- Mobile matrix scroll сохраняется, selected cell открывает full-width Drawer; не employee-day cards. Remove локальные conflicting colors/state notices только при polish. Primitives KEEP grid/MonthPeriodPicker; FilterBar, Field, Drawer, Alert, Skeleton. Risk высокий при touch/cell editing, минимизировать изменения domain handlers. Dependencies Wave0 и готовый inspector; validate GP-TS-001…004, monthly boundaries, historical values, comments/capability, no month creation on read, export unchanged.

## Candidates — POLISH

- Current/target: CandidateRegistry и detail/create, reserve view shared. Registry + лёгкий workspace, сохранить SLA/manager response/reserve state, не создавать Employee при reserve.
- Information/columns: Кандидат (name/contact) / Ответственный менеджер / Состояние / Срок ответа / overflow, только available fields; secondary source/notes in detail. Primary registry «Добавить кандидата», detail existing contextual manager response; secondary edit если supported; overflow archive with ConfirmDialog.
- Filters existing search/status/manager, advanced остальные current fields; без новых аналитических counters. Detail sections «Карточка / Ответ менеджера / История» в одном коротком flow, tabs не обязательны. Create Field/FormGrid, сохранить domain payload.
- Desktop compact table, mobile compact list с name/status/response due. Remove raw enum fallback и native archive confirm, унифицировать notices. Primitives PageHeader/EntityHeader, DataTable(list), FilterBar, Field, ConfirmDialog, Alert/EmptyState. Risk средний SLA; dependencies Wave0; validate GP-CAND, manager responses и reserve linkage, permissions unchanged.

## Counterparties — POLISH

- Current table/form/detail/archive; target тот же Registry + compact workspace. Сохранить реквизиты и связи объектов. Prominent business name/status, secondary contact/requisites, metadata history если уже есть.
- Columns Наименование / Реквизиты (семантически связанные identifiers) / Контакт / Статус / overflow; не вводить отсутствующее поле или financial summary. Filters только existing search/status. Registry primary «Добавить», detail primary «Редактировать» когда нет другой routine action, secondary none, archive в overflow/ConfirmDialog.
- Sections «Реквизиты / Контакты / Связанные объекты», tabs не требуются. Desktop table, mobile сохраняет horizontal overflow; не делать новый mobile renderer в polish. Remove native confirm/local notice styling, не разрывать существующие object links при archive.
- Primitives PageHeader/EntityHeader, DataTable(scroll), Field/FormGrid, ConfirmDialog, Alert. Risk низкий/средний archive связей; dependencies Wave0; validate creation/edit/archive, denied related objects и empty results.

## Absences — POLISH

- Current полноценный минифицированный CSS Module с toolbar/editor/list/responsive, не пустой файл. Target сохранить compact list/editor, не новый calendar application.
- Prominent user/absence type/period, secondary comment and status; user absence не Employee availability. Columns/list fields имя / тип / период / статус / комментарий / actions сохраняют смысл. Primary «Добавить отсутствие», secondary none; row edit quiet, delete overflow→ConfirmDialog.
- Filters существующие user/type/period/status controls распределить по Search+≤2 primary+advanced только для реально поддерживаемых условий; если search нет, не вводить. Detail tabs неприменимы, edit существующим inline editor с Field/FormGrid.
- Desktop list, medium collapse editor, mobile1col. Current mobile скрывает period/status: при polish важный период перенести под имя, status дать в строке/раскрытии, не требовать угадывания. Remove native delete confirm, дубли визуальных field rules. Primitives FilterBar, Field/FormGrid/FormActions, ConfirmDialog/StatusBadge. Risk низкий, dependencies Wave0; validate overlap/date/type и доступы существующей формы.

## Files — POLISH

- Current/target `/files/[fileId]/view` специализированный viewer, сохранить preview states/security/download URLs. Prominent filename/content, secondary format/size/processing state; technical fileId не header.
- Primary «Скачать» лишь когда существующий flow разрешает, secondary Back, overflow только current supported operations. Search/filter/table/tabs неприменимы. Keep preview pending/failed/unsupported и AttachmentPreviewList consumers.
- Desktop fit viewport, mobile preview scroll/fit зависит от media, не обрезать document. Alert+retry безопасного чтения, Skeleton, EmptyState для not found/forbidden. Remove только дубли состояний и технические ошибки. Risk средний signed URLs/media; dependencies Wave0, выполнять перед окончанием chat visual rollout. Validation supported/unsupported/processing/denied/download and back.

## Settings — P1, hide until useful

- Current visible placeholder16 строк обещает user/access/system settings без реализации. Решение: убрать навигационные entry points до появления функций. Не определять fake minimal settings и не открывать ACL administration под видом polish.
- В Wave4 удалить entry из sidebar, account menu и global command registry одновременно; `/settings` сохранить для старых ссылок. Utility view: PageHeader «Настройки», EmptyState «Настройки пока недоступны», LinkButton «На рабочий стол». Нет формы, filters, table, tabs, destructive/secondary/overflow actions.
- Prominent честная доступность, secondary краткий текст; desktop/mobile один блок. Keep auth boundary и URL совместимость, не удалять account logout/profile summary. Primitives PageHeader, EmptyState, LinkButton. Risk низкий; dependency финальная проверка navigation surfaces. Validate direct URL, search menu/links, logout остаётся доступен. Будущий settings scope — отдельная продуктовая задача.

## Dependency-aware wave plan

Каждая wave — несколько небольших module PR, не один массовый diff. UI migration не меняет API/DTO/ACL/schema/seed. Указанные проверки — план последующей реализации, не запуск CI на этапе документов.

| Wave | Prerequisite primitives | Modules / order | Risk | What not to touch | Validation gate |
|---|---|---|---|---|---|
| 0 Foundation | Existing foundation + token contract | EXTEND Button/IconButton/Surface/Badge/EmptyState/Skeleton → headers/fields → Dialog/Reason/Confirm/Drawer/Popover/menu → FilterBar/Table/Tabs/Pagination; небольшой isolated consumer первым | CSS cascade, focus | Не массово менять reference screens; не alias всех legacy colors сразу | Existing shell/login/Objects smoke, primitive keyboard/pending/error, 390/768/1280/1600px, contrast/zoom |
| 1a Decision queue | Stable overlays/actions/state, FilterBar | Approvals first; typed human presentation adapter | High stale permission/decision | DTO/payload formats/approval actors | GP-APR, reject/cancel/pending/error, scoped links, no UUID primary |
| 1b Operational finance/resources | 1a decision shell, DataTable, forms/tabs | Inventory → Equipment; Accountability после decision shell, может идти отдельно от catalog migrations | High money/deletion/evidence | Stock calculations, soft/hard-delete, ledger math, scope ACL | GP-INV/EQP/EXP, version conflicts, histories, current totals, issue photo exceptions, card vs table mobile choices |
| 2 Entity workspaces | Wave1 resource panels, stable tabs/reason dialogs | Tasks → Employees → Orders; object create/edit локально по готовности forms | High mount/draft/lifecycle | Reference Objects detail anchors, payment/task lifecycle, user/employee mapping | GP-TASK/HR/OTO, tab draft persistence, reset confirmations, media and scope links, backend request equivalence |
| 3 Communication and polish | Stable overlays/state from previous waves | Files state polish → Chats visual extraction; Candidates/Counterparties/Absences независимо; Timesheet last in isolated PR | Chats/matrix high, registry polish low | Socket/effects/scroll algorithm, finalValue/export/manual capability; no new planner | Two-client chat suite, media states, GP-CAND/TS, keyboard matrix/mobile inspector, archive behavior |
| 4 Navigation and orphan cleanup | All migrated consumer usages verified | Settings hide; final per-family orphan CSS removal; remaining reference token cleanup только при доказанной необходимости | Cascade/unused detection | Не удалять rules по одному search без dynamic/portal check | Route/navigation sweep, login/global command/sidebar, states at all breakpoints, scoped tests for remaining selector owners |

Chat P0 отложен до Wave3 из-за стабильности shared overlays и большого realtime/scroll controller. Timesheet matrix не используется как pilot DataTable. Reference dashboard/shell не являются обязательным rewrite dependency.

Каждый PR фиксирует: route scope; existing behavior/data preserved; shared primitives adopted; selectors removed; manual/scoped automated checks. Не смешивать extraction of effects, new backend features и visual migration. Rollback — revert конкретного module PR; legacy rules удаляются лишь после migrated consumer, чтобы частичный rollout оставался работоспособным. Не требовать runtime feature flags или новой infrastructure ради миграции.

## Legacy CSS strangler migration

### Ownership boundaries

| Layer | Owns | Must not own |
|---|---|---|
| `app/globals.css` target | Reset, document/body base, временно оставшиеся clearly labelled legacy rules | Новые domain selectors/visual tokens |
| `shared/styles/design-tokens.css` | Все visual values `--ui-*`, существующие scale и semantic tokens | Domain status enum mapping |
| `shared/styles/ui-foundation.css` | Общие primitive recipes и variants | Route-specific selectors |
| `shared/styles/product-shell*.css` | Shell rail/topbar/context only | Inventory/approval/form styling |
| Shared primitive CSS Modules | Layout/state конкретного primitive, если он не использует foundation recipe | Альтернативная палитра/reset native controls на весь app |
| Feature/page CSS Modules | Domain composition, columns, matrix/chat specifics | Копии Button/Badge/Dialog и local hex system |
| Existing domain shared styles | Timesheet/chat/dashboard scope до локальной миграции | Новые глобальные overrides других модулей |

### Incremental sequence

1. Создать/расширить primitive на existing `--ui-*`. Сначала scoped consumer с явными классами, а не broad `.app-shell button` override. Учитывать `button[type=submit]` legacy specificity и другие compound selectors, порядок import не решает всё.
2. Перевести один module/одну область, удалить её inline decoration и old classes из markup после feature verification. KEEP legacy CSS для остальных consumers. Dynamic widths/positioning не считать декоративным debt автоматически.
3. Для каждой старой selector family проверить `rg` usage во всём frontend, template literals/class maps, data attributes/pseudo-elements, media queries, portal contents и indirect shared consumers. Отсутствие exact string — недостаточно; записать owner/mapping в PR.
4. Удалить только proven orphan declarations/rules и их orphan responsive variants отдельным небольшим diff. Если selector multi-owner, сначала разделить или оставить; не удалять всю секцию из-за одного migrated route.
5. Старые `--primary/--surface/...` удалять только после последнего consumer, не перекрашивать legacy весь сразу alias к `--ui-*`. Не вводить третью систему. `product-shell-wave-1-1.css` коррекции rail сохраняются, пока consolidated shell реально их не заменил и не проверен.
6. После deletion проверить migrated module и shared/reference consumers на default/hover/focus/disabled, narrow viewport и overlay. Никакого удаления 4853 строк одним коммитом; размер сокращения — следствие потребителей, не target metric.

## Cross-document consistency and completion checklist

- Geometry/radius/colors только из Architecture; listed components exist as contracts, RegistryToolbar/EntitySummary/QueueRow/Ledger/Inspector обозначены compositions, не неожиданные новые shared widgets.
- Audit facts сохранены:43 pages,14 native-dialog files, nonempty one-line absences CSS, current equipment cards, current inventory horizontal table. Target equipment table явно отделён от current facts.
- Reference statuses и приоритеты сохранены; native Dialog migration не меняет reason requirement или deletion policy. Settings реализует конкретное hide решение, не fictional features.
- Каждый route family имеет target, actions, layout/responsive, risks/dependencies; работа завершается per module, не после переписывания всего frontend.
- По итогам будущей реализации counts/totals и mutation outcomes сравниваются с исходным контрактом, UI only не является разрешением исправлять backend drift.
