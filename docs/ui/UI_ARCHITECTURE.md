# Service Ops UI Architecture

## Status and scope

Архитектурный контракт для последующей реализации. База: `dev`, HEAD `1e8c28a653a3efce50269211443202734eebf5b9`. В момент подготовки checkout — detached HEAD, совпадающий с локальным `origin/dev`. Исходная инвентаризация: [UI_AUDIT.md](UI_AUDIT.md); 43 page-файла = 41 экран `(app)` + login + root redirect. Полный аудит повторно не выполнялся.

Этот документ задаёт визуальные и интерактивные правила; [COMPONENT_CONTRACTS.md](COMPONENT_CONTRACTS.md) — API компонентов; [MODULE_ROADMAP.md](MODULE_ROADMAP.md) — применение и порядок миграции. При расхождении по геометрии приоритет у этого документа, по API — у Component Contracts, по размещению domain content — у Module Roadmap. Бизнес-правила определяют product-contract, access-matrix, glossary, reconciliation-notes и open-questions-register, а не UI-архитектура.

Все описанные изменения — целевое состояние, а не утверждение о текущем runtime. DTO, endpoints, ACL, расчёты, lifecycle и правила удаления сохраняются. Недостающие данные не подменять догадками и не компенсировать неограниченной загрузкой связанных сущностей. Новое business requirement требует отдельного решения в реестре открытых вопросов; это не разрешение расширить текущую миграцию.

## Product principles

Порядок оптимизации: понять состояние → выполнить регулярную операцию → сравнить плотные данные → предсказать поведение → различить главное и вспомогательное → визуальная аккуратность. Количество карточек и декоративность не являются метриками качества.

Одна операция имеет одинаковые название, место, pending/error и confirmation behavior во всех модулях. Доступность действия определяется существующими capabilities. Шаблон сам не проверяет роли и не разрешает операцию. Существующие удачные экраны сохраняются: shell, login, dashboard, Objects registry/detail.

## Information hierarchy

| Уровень | Содержание | Представление |
|---|---|---|
| Primary | Бизнес-название, текущее требующее решения состояние, сумма/срок когда они определяют действие | Первая строка, основной текст, один статус, одна primary action |
| Secondary | Адрес, назначение, участник, источник операции, пояснение суммы | Вторая строка или summary, secondary text |
| Metadata | Автор, время, период, последняя правка, счётчики | 12px; не заменяет бизнес-название |
| Technical | UUID, sourceEntityType, коды событий/ошибок, версии | Закрытая секция «Технические сведения» по явному раскрытию |

UUID не является названием, subtitle, колонкой реестра или обязательным полем обычного поиска. Допустим в копируемых технических сведениях для диагностики, только если уже доступен пользователю в response. Секция не даёт новых прав. Человеческие номера договора, инвентарные и серийные номера — бизнес-идентификаторы, показываются в обычном интерфейсе. Неизвестный enum отображается как «Неизвестное состояние», исходный код — только в technical details. Недоступная связанная сущность отображается разрешённым названием без ссылки; не загружать её в обход scope.

## Canvas and surface model

Единственный источник значений — `shared/styles/design-tokens.css`, семейство `--ui-*`. Не создавать `--crm-*`, theme v3 или локальный набор hex. Существующие токены сохраняют имена и значения, пока отдельная проверка контраста не требует коррекции в том же файле.

| Surface | Background | Border | Shadow | Применение |
|---|---|---|---|---|
| Canvas | `--ui-canvas` | Нет | Нет | Пространство между блоками |
| Standard | `--ui-surface` | 1px `--ui-border` | Нет | Реестр, section, форма |
| Subtle / inset | `--ui-surface-subtle` / `--ui-surface-muted` | Общая граница родителя; собственная лишь у отдельного блока | Нет | Summary, headers, read-only context |
| Floating | `--ui-surface` | 1px `--ui-border` | Только разрешённый elevation token | Menu, popover, modal drawer |
| Selected | `--ui-accent-subtle` | `--ui-border-strong`; видимый selected marker | Нет | Выбранная строка/комната; не весь workspace |
| Warning / danger | `--ui-warning-subtle` / `--ui-danger-subtle` | Соответствующий semantic border | Нет | Локальное предупреждение/ошибка |

Не вкладывать белую карточку в белую карточку ради отступа: использовать Section/divider. Hover меняет background, не положение и не elevation. Градиенты, floating static cards, декоративные KPI и glow запрещены в мигрированных поверхностях. Skeleton целевой — однотонный, без shimmer gradient. Pills остаются только для компактного числового unread count и круглых avatars; status/filter badges прямоугольные с малым радиусом.

## Elevation model

| Level | Слой | Shadow / порядок |
|---|---|---|
| 0 | Canvas | none |
| 1 | Static surface, table, summary | none |
| 2 | Sticky header, toolbar, inline inspector | none; border и непрозрачный background |
| 3 | Popover/menu/tooltip, modal drawer/dialog | `--ui-shadow-popover` для первых; `--ui-shadow-dialog` для modal drawer/dialog |

Разрешены ровно существующие shadow tokens: popover = `0 12px 32px rgba(42,36,31,.12), 0 2px 8px rgba(42,36,31,.06)`; dialog = `0 24px 64px rgba(42,36,31,.16), 0 4px 12px rgba(42,36,31,.08)`. Focus ring — индикатор фокуса, не elevation.

Целевой порядок z-index: sticky content 10, topbar 35, desktop sidebar 50, ordinary popover 100, modal backdrop/panel 300/310, popover внутри modal 320, tooltip 330. Не менять shell stacking глобально до миграции зависимых overlays. Portal modal находится вне скроллирующей таблицы. Backdrop использовать единообразно через будущий `--ui-overlay-scrim: rgb(37 34 31 / 24%)` в существующем token-файле, не повторять цвет в модулях.

## Geometry

Значения ниже обязательны для новых/migrated компонентов; references не подгонять массово ради нескольких px.

| Элемент | Размер |
|---|---|
| Spacing scale | Существующие `--ui-space-0/1/2/3/4/5/6/8/10/12`: 0/4/8/12/16/20/24/32/40/48px |
| Page gutters | Desktop 24px, medium 20px, mobile 12px; bottom 32px + safe-area |
| Header → content, section gap | 24px; mobile 16px |
| Surface padding | 16px; compact 12px; table surface 0 |
| Field label/help gap | 4px; между полями 16px, form sections 24px |
| Dense table cell | 8px vertically / 12px horizontally; min row 40px, two-line 56px |
| Queue row | 12px / 16px; min-height 64px, растёт с текстом |
| Control height | sm 30px, md 36px, lg 42px — existing tokens |
| Touch control | Minimum hit area 44×44px; mobile/touch расширяет hit area или min-height до 44px |
| Radius | Badge 4px (`xs`); chip/menu item 6px (`sm`); control/surface 8px (`md`); overlay 10px (`lg`) |
| Registry/workspace max-width | 1480px (`--ui-content-max`), centered |
| Form width | 800px max; extended existing object/order create forms 1040px; one-column dialog form 560px |
| Full-width exceptions | Objects existing workspace/registry, existing dashboard shell wide container (его inner max-width сохраняется), timesheet, order calendar/workforce, chats, desktop financial review; min-width:0 на контейнерах |
| Drawer | Preview 480px, review 640px; max-width viewport−24px; mobile full width |
| Review split | Left 360px, right minmax(0,1fr), gap 16px; включать при ширине main content ≥1040px |

Ширина браузера и доступная main column отличаются из-за sidebar. Two-pane review включается по доступной ширине; иначе drawer, даже на desktop с раскрытым sidebar. Не добавлять динамические inline styles для обычных отступов; вычисляемая ширина column/skeleton/virtual positioning допустима как API primitive.

## Typography

Шрифт `--ui-font-sans`, body line-height `--ui-leading-normal` (1.45); heading `--ui-leading-tight` (1.25). Масштаб rem, поддержка zoom, фиксированная высота не обрезает текст.

| Role | Размер / weight | Правило |
|---|---|---|
| Page title | 24px / 700 | Один h1; mobile 20px |
| Entity title | 24px / 700 | Перенос строк, не обрезать важное имя |
| Section title | 16px / 600 | h2/h3 по структуре |
| Body / field value | 14px / 400 | Primary text |
| Dense table | 13px / 400; identity 600 | Не уменьшать при нехватке ширины |
| Metadata / label | 12px / 400 или 600 | Важные labels secondary, а не disabled color |
| Financial summary | 20px / 600 | tabular-nums; не giant KPI |
| Numbers in rows | 13px / 400 | Справа, tabular-nums, единица/валюта указана |

Table headings — обычный регистр, 12px/600; без uppercase и letter-spacing. Uppercase допустим только неизменяемому бренду/аббревиатуре, не как механизм иерархии. Денежные поля форматировать ru-RU с валютой, сохраняя точность источника; ноль отличается от отсутствующего значения «—». Даты не переинтерпретировать: сохранить domain timezone, date-only не превращать в смещённый timestamp.

## Semantic color system

| Meaning | Tokens | Usage |
|---|---|---|
| neutral | `--ui-text`, secondary, surface, border | Обычные значения, in-progress без риска |
| accent | `--ui-accent`, hover/pressed/subtle/contrast | Primary action, selection/navigation |
| info | `--ui-info`, subtle/border | Справка, ожидаемый процесс; существующий приглушённый info не brand blue |
| success | `--ui-success`, subtle/border | Завершённое подтверждённое действие |
| warning | `--ui-warning`, subtle/border | Нужна проверка, pending review, неблокирующее отклонение |
| danger | `--ui-danger`, hover/subtle/border | Ошибка, критическая просрочка, опасное действие |
| muted | `--ui-text-secondary`, surface-muted | Архив, отменено, неактивно; tertiary только для необязательных metadata |

Цвет не является единственным носителем смысла. Текст и при необходимости иконка обязательны. Проверять контраст фактических пар; если tertiary не проходит для мелкого текста, использовать secondary, а не снижать требования.

## Status system

Prominent: одно текущее препятствие/решение около identity (например «Ожидает согласования»). Subtle: обычный lifecycle status компактным StatusBadge. Muted: архив/отмена, без opacity на всей строке. Danger: ошибки, явно просроченное требуемое действие; отклонённое в истории не должно делать весь экран красным.

Badge нужен для конечного состояния, которое сравнивают между строками. Категория, должность, объект назначения, дата и сумма — текст, не badge. Один lifecycle badge + максимум один exception indicator на строку; остальные детали в drawer. UI mapping хранится в domain presentation helpers; primitive не знает enum и не вычисляет lifecycle. Нельзя выводить статус «склад» только из отсутствия assignment у неисправной/списанной единицы.

## Action hierarchy

EntityHeader: 0–1 primary + 0–1 secondary + OverflowMenu. Недоступность regular primary не повышает destructive action до primary автоматически. В форме и активном review своя локальная primary, но не дублировать её одновременно в header и footer одной области.

| Action | Appearance | Placement |
|---|---|---|
| Primary | Existing Button primary, mocha fill | Следующая регулярная операция |
| Secondary | Existing Button default, border | Альтернативная частая операция |
| Quiet | Existing Button ghost / обычная ссылка | Navigation, раскрытие, отмена формы |
| Destructive | Danger text в menu; danger fill только в confirmation | После divider в overflow |
| Overflow | IconButton «Другие действия» | Редкие edit/lifecycle/administration actions |

Equipment: на складе «Выдать», назначено «Вернуть», неисправно «Отправить в ремонт», в ремонте «Вернуть из ремонта» — только если соответствующая capability разрешает. Перемещение/edit вторичны по контексту; списание и ошибочное удаление — разные overflow actions. Ни один frontend status не расширяет capabilities.

## Page archetypes

### Registry

PageHeader → RegistryToolbar (композиция FilterBar, не второй независимый primitive) → DataTable или явно выбранный list → Pagination. Title может занимать существующий context slot shell только в сохранённых references; новые страницы имеют один h1. Create — одна action в header, не копия в toolbar. Search 300ms debounce, 1–2 основных фильтра, advanced filters по кнопке. State сохраняется в URL с существующими именами параметров; browser Back восстанавливает запрос и страницу. Изменение фильтра/сортировки сбрасывает page; сортировать только поддерживаемые поля и весь соответствующий dataset, не одну server page.

### Entity Workspace

Back/breadcrumb → EntityHeader → EntitySummary → Tabs → content. Identity слева, status рядом/на следующей строке, actions справа. Summary: до 4 ключевых значений, компактная полоса, mobile 2 колонки. Детальные поля в sections. Destructive management — overflow с объяснением последствий. Tabs записывают `tab` в URL без потери existing params; недоступная вкладка не рендерится; неизвестная возвращает к первой разрешённой. Не терять draft при смене вкладки.

Исключение reference: Objects detail сохраняет существующие anchor sections (`#overview`, `#today`, `#team`, `#tasks`, `#inventory`, `#equipment`, `#files`, `#history`). Это navigation по одному workspace, не ложный ARIA tablist. Миграция на Tabs не обязательна и не входит в waves.

### Queue

PageHeader → compact counters → FilterBar → queue list → selected detail Drawer. На широкой области допускается тот же detail inline, без modal semantics. Строка: предмет решения + entity, инициатор/дата, значимая сумма/количество, status. Решение принимается внутри выбранной detail области; в строке нет множества primary buttons. Counters только из реально доступного полного scope; partial counts явно подписаны, не выдаются за глобальные.

### Operational Matrix

Toolbar (scope + period + actions) → dense grid → inspector. Общие FilterBar/Field/MonthPeriodPicker; grid сохраняет domain editing semantics. Sticky identity и даты, горизонтальный scroll, отдельный cell focus/selection. Inspector справа при достаточной ширине, modal Drawer на medium/mobile. DataTable не подменяет spreadsheet grid.

Dashboard, Login, file viewer и Chats — осознанные специализированные layouts, не пятый шаблон для произвольных реестров. Их контракты описаны в roadmap.

## Filter architecture

Desktop: SearchField (240–400px, растёт) + до 2 domain-primary фильтров + «Фильтры (N)». Дополнительные условия в Popover, длинные формы в Drawer. Applied FilterChips в строке ниже, wrap без скрытых условий. Primary filters применяются сразу; advanced имеют draft, «Применить»/«Сбросить», закрытие без применения оставляет applied state. Chips удаляют условие сразу.

Mobile: search на всю ширину, следующая строка primary filter и кнопка «Фильтры»; остальные условия в full-width Drawer, chips переносятся. Счётчик отражает advanced applied conditions. Нет одновременно огромной постоянной advanced panel и кнопки «Фильтры». Scoped deep link (например approvals по объекту) — отдельный подписанный chip; общий reset не снимает scope без явного удаления этого chip. Unsupported search/filter не рисовать; local filter допустим только для полного уже загруженного набора, с объявленным scope.

## Data table architecture

Native semantic table внутри scroll region; raw HTML table сам по себе не ошибка. Shared DataTable задаёт geometry, state и navigation, domain задаёт колонки/renderers. Identity column: название-link + secondary line (адрес/категория). Числа справа, dates/status стабильной ширины, actions последняя колонка 44px. Обычно 5–7 смысловых колонок; при 10–12 сначала объединить связанные данные (количество + единица, назначение + тип места), не уменьшать шрифт.

Click пустой области строки повторяет main link; selection текста и вложенные links/buttons не запускают row navigation. Основная ссылка обеспечивает keyboard и open-in-new-tab. Строка не получает `role=button`; preview — отдельная подписанная кнопка. Sort button в th + `aria-sort`; только поддерживаемые sort keys, сохранить existing default до отдельного domain решения. Header sticky внутри scroll container, при document scroll учитывать topbar 56px. Не создавать одновременно два scroll owner одной оси.

EmptyState располагается на всю ширину, error отделён от zero records. При refetch старые строки сохраняются с aria-busy; их mutable actions блокируются только если данные могут устареть для операции. Pagination использует server totals; client pagination допустима для полного списка, никогда не изображает несуществующий backend total.

Mobile choice задаётся module roadmap: compact list для identity-oriented registry; horizontal table для stock/finance/comparison; matrix всегда scroll. Данные hidden columns доступны в detail. Не рендерить одновременно две доступные для screen reader копии списка.

## Form architecture

Label сверху, не placeholder вместо label. Required: символ * рядом с label + native required/aria-required, общая фраза «* — обязательные поля». Help под полем; error заменяет/дополняет help, связан через aria-describedby. Валидация после blur/submit, не на первой букве; submit focus на первом invalid field и error summary для длинной формы.

Create: отдельная страница с PageHeader, Surface, Section, FormGrid, FormActions. Edit: тот же domain form в workspace section или Drawer для ≤6 простых полей; длинное редактирование использует существующий route либо отдельное состояние workspace, не modal на десятки полей. Две колонки только при available width ≥640px и разумной длине полей; длинные descriptions full-span. Не создавать edit route ради шаблона.

FormActions: «Сохранить»/конкретный глагол primary, «Отмена» quiet. Pending не очищает данные; ошибка сохраняет draft. Version conflict: Alert + «Обновить данные», сохранить введённое для сравнения, не blind retry mutation. Удаление не в одном ряду с Save. Unsaved change navigation получает ConfirmDialog; reload/закрытие браузера может использовать native beforeunload как browser limitation, это не разрешение window.confirm/prompt для product actions.

## Dialog / Drawer architecture

Dialog — короткое изолированное действие, максимум 560px. ConfirmDialog — последствия и подтверждение, no reason input. ReasonDialog — reason-required операция, label «Причина», существующая validation/min-length; произвольные новые ограничения не вводить. Drawer — просмотр контекста/небольшое редактирование без потери очереди. Popover — фильтры и короткий выбор, не опасная транзакция.

Modal overlay: заголовок, close, initial focus, trap, inert background, Escape и возврат фокуса. Для destructive confirm initial focus на Cancel; outside click не подтверждает. Pending mutation блокирует повтор, modal не закрывается до результата; close/Escape в этот короткий период не создаёт ложной отмены уже отправленного запроса. После успеха обновить источник и detail; исчезнувшая строка возвращает фокус ближайшей строке/заголовку. Сетевую ошибку показывать внутри overlay, не стирать причину. Вложенный ReasonDialog временно приостанавливает trap Drawer, закрытие возвращает туда. Browser-native confirm/prompt из 14 файлов подлежат последовательной замене при миграции модулей.

## Empty / Loading / Error

Initial loading — Skeleton формы/строк с теми же колонками и label «Загрузка» у контейнера aria-busy. Skeleton aria-hidden, без декоративной анимации; reduced-motion соблюдается. Refetch сохраняет контент и позицию. Field/action pending не скрывает страницу.

Error — Alert с человеческим текстом и retry только для безопасного чтения; mutation retry после проверки результата, без автоматического повторного финансового действия. Нет raw backend English message в основном UI. Empty collection — причина и разрешённое Create. Filter-empty — «Ничего не найдено» + «Сбросить фильтры». Not found и forbidden — отдельные состояния без Create и без ложной пустоты. Partial section failure не скрывает весь workspace. Успех действия — локальное role=status подтверждение; не создавать новый toast framework.

## Responsive architecture

Desktop >1100px, medium 761–1100px, mobile ≤760px — ориентиры существующего shell. Mobile rail 58px, desktop collapsed/expanded 68/236px, topbar 56px сохраняются. Module two-pane/form breakpoints зависят дополнительно от доступной ширины, указанной в Geometry.

Medium: toolbar wrap, sidebar behavior существующий, detail inspector становится Drawer при нехватке места, таблица сохраняет scroll. Mobile: actions под title, primary заметна, вторичная может перенестись, overflow остаётся доступным; Tabs horizontal scroll без dropdown, активная вкладка видима. Modal Drawer занимает доступный viewport (`100dvh`), footer не перекрывает fields; учитывать экранную клавиатуру и safe-area. Touch rows не менее 44px, text zoom не обрезает названия. Horizontal overflow допускается внутри подписанной table/matrix region, не у документа.

## Accessibility contract

Native semantics первичны. Focus-visible: existing ring + контрастная граница; не убирать outline без замены. Contrast target: 4.5:1 normal text, 3:1 large text/controls; проверить реальные token combinations при реализации. IconButton всегда имеет русское action label; tooltip не заменяет имя.

Tabs: arrow keys/Home/End, manual Enter/Space activation для async content; nav links не получают tab roles. Menu: arrows/Home/End/Escape, focus return. Table: native links/buttons; matrix: roving cell focus, arrows, Enter edit, Escape cancel, не перехватывать стрелки внутри input. Dialog доступен клавиатурой и screen reader, заголовок связан. Errors связаны с полем, status updates aria-live polite, blocking errors alert без повторного объявления на каждый render.

Disabled controls не обещают действие; видимая причина доступна вне disabled tooltip. Loading button сохраняет label и ширину, aria-busy и защита от double submit. Touch targets ≥44px, keyboard targets не меньше 24px; плотность достигается группировкой данных, а не недоступными controls.

## Acceptance boundary

Экран принимается, когда использует размеры/семантику выше, route/query state и existing capabilities сохранены, одинаковые действия используют Component Contracts, mobile strategy соответствует roadmap. Существующий reference не переписывается ради нового имени компонента. Проверка дальнейшей реализации включает 390/768/1280/1600px, keyboard, zoom 200%, initial/refetch/empty/error/forbidden/pending, реальные бизнес-сценарии из golden-path-index. Этот документационный этап не запускает build/CI, не создаёт screenshots.
