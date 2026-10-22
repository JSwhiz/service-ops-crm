# Откуда берётся визуал страниц (frontend)

Актуально на 2026-10-22. Порядок каскада задаёт `apps/frontend/src/app/layout.tsx`.

## 1. Слои стилей

| # | Источник | Что в нём | Кто владеет | Статус |
|---|----------|-----------|-------------|--------|
| 1 | `app/globals.css` (~4.7k строк) | Базовые стили элементов: reset, `html/body`, `a`, нативные `button`/`input`/`textarea`. **Legacy-кит классов**: `page-card`, `page-muted`, `section-title`, `detail-*`, `action-row`, `workspace-page`, `page-stack`, `workspace-surface`, `hero-card`, `record-card`, `data-table`. **Доменные блоки**: календарь разовых заказов, обзор табеля, чаты, реестр/карточка разовых заказов, задачи, подотчёт, склад/оборудование, просмотр файлов, уведомления, `searchable-select` | общий | Мёртвых правил нет. Доменные блоки нужно переносить в CSS-модули своих фич |
| 2 | `shared/styles/design-tokens.css` | Только `--ui-*` токены: цвета, типографика (Inter), отступы, радиусы, высоты контролов, тени | дизайн-система | Единственный источник значений. Старых алиасов (`--text`, `--primary`, `--border`…) и частных палитр (`--chat-*`, `--cp-*`) больше нет |
| 3 | `shared/styles/ui-foundation.css` | Классы `.ui-*` для компонентов foundation: Button/ButtonLink, IconButton, Badge/StatusBadge, Alert, Field, Surface, PageHeader, EntityHeader, BackLink, FactStrip, Stack, Skeleton, EmptyState | дизайн-система | Целевой слой |
| 4 | `shared/styles/app-shell.css` | Каркас: сайдбар (развёрнутый и свёрнутый), шапка, область контента, уведомления в шапке | shell | Склеен из `product-shell.css`, `product-shell-wave-1-1.css`, `topbar-communication.css` и shell-правил из globals |
| 5 | `shared/styles/global-command.css` | Глобальный поиск и меню «+» в шапке | shell | Ок |
| 6 | `shared/styles/timesheet.css` | Страница табеля и редактор ячеек | табель | Склеен из `timesheet-page.css` и `timesheet-editing.css` |
| 7 | CSS-модули `shared/ui/*/*.module.css` | Стили общих компонентов: date-picker, searchable-select, overflow-menu, overlays, table-pagination, registry-filters, phone-list-field, user-avatar, workspace-tabs, data-table… | компонент | Целевой слой |
| 8 | CSS-модули `features/*/ui/*.module.css` | Раскладка конкретной фичи (карточка сотрудника, кандидата, объекта, разового заказа…) | фича | Ок; местных кнопок и цветов не осталось |
| 9 | CSS-модули `app/(app)/**/*.module.css` | Раскладка конкретной страницы (реестры, контрагенты, согласования, чаты, новый объект) | страница | Ок; часть фильтров ещё собственная (counterparties, approvals) |
| 10 | Inline `style={{…}}` | 218 мест: раскладка в старых формах (заказ, склад, подотчёт, менеджеры объекта) | — | Переносить в Stack/Field/модули; захардкоженных цветов в TSX больше нет |
| 11 | Стили из JS | Цвет аватара (`UserAvatar`, палитра в компоненте), позиционирование поповеров (`usePopoverPlacement`), тон статуса (`StatusBadge` по коду статуса) | компонент | Ок |

## 2. Матрица «элемент → компонент → стили»

| Элемент интерфейса | Использовать | Стили | Чем заменено |
|---|---|---|---|
| Кнопка действия | `Button` (`variant` default/primary/ghost/danger, `size`, `icon`, `pending`) | ui-foundation | `.button-secondary`, `.button-danger`, локальные `primaryButton/secondaryButton/quietButton/primaryAction/secondaryAction/actionButton/textAction` |
| Ссылка в виде кнопки | `ButtonLink` | ui-foundation | `.button-link`, `.button-link--primary` |
| Кнопка создания | `ButtonLink`/`Button` `variant="primary" icon={<PlusIcon />}` | ui-foundation | локальные `createButton` |
| Иконка-кнопка | `IconButton` (`bordered` рядом с кнопками шапки) | ui-foundation | — |
| Иконки | `shared/ui/icons` (Plus, Close, Check, Search, Chevron*, ArrowRight, Calendar, Download, Pencil) | currentColor, сетка 20 px | 12 локальных SVG-функций |
| Выпадающий список | `SearchableSelect` / `SelectField` (с подписью и ошибкой) / `Select` (замена нативного `<select>` с `<option>`) | searchable-select (globals) + модуль | 42 нативных `<select>` |
| Дата / дата и время | `DatePicker` (дни → месяцы → годы) | date-picker module | нативные `type=date/datetime-local` |
| Поле формы с подписью | `Field` (label, required, error, description) | ui-foundation | `<label><div style={{marginBottom: 6}}>…` (36 мест) |
| Несколько телефонов | `PhoneListField` | phone-list-field module | `CandidatePhoneFields` |
| Статус | `StatusBadge status="…"` (тон из одной карты) / `Badge tone` | ui-foundation | `.status-pill[data-status]` |
| Сообщение / ошибка | `Alert tone` | ui-foundation | `.inline-notice`, `div style={{color:'#b91c1c'}}` |
| Вертикальная раскладка | `Stack gap="xs…xl"` | ui-foundation | `div style={{display:'grid',gap:N}}` (16 мест) |
| Карточка / секция | `Surface` | ui-foundation | ⚠️ ещё `.page-card` (165), `.workspace-surface` (51), `.record-card` (28) |
| Шапка страницы | `PageHeader` | ui-foundation | ⚠️ ещё `PageTitle` + `.page-title` |
| Шапка сущности | `EntityHeader` + `BackLink` + `UserAvatar variant="soft"` + `FactStrip` | ui-foundation, user-avatar module | собственные avatar/summary/backLink в карточках сотрудника и кандидата |
| Действия в «⋯» | `OverflowMenu` | overflow-menu module | — |
| Диалоги | `Dialog`, `ConfirmDialog`, `ReasonDialog`, `Drawer` | overlays module | нативные confirm |
| Таблица реестра | `DataTable` + `TablePagination` (строк на странице) + `RegistryToolbar` | data-table, table-pagination, registry-toolbar | ⚠️ таблицы на `.data-table` и собственные фильтры в counterparties/approvals |
| Вкладки | `WorkspaceTabs` | workspace-tabs module | — |
| Пустое состояние / загрузка | `EmptyState`, `Skeleton` | ui-foundation | ⚠️ ещё `.workspace-empty` (14) |
| Вторичный текст / подписи | — | — | ⚠️ ещё `.page-muted` (166), `.section-title` (60), `.detail-label/value/field` (≈140), `.action-row` (47) |

## 3. Что сделано в чистке 2026-10-22

- Удалены неиспользуемые правила (аудит по всем `.ts/.tsx`): ~450 правил в globals и модулях, `dashboard-workspace.css` целиком, 160 объявлений, перекрытых таким же селектором ниже по каскаду.
- 5 глобальных файлов → 3: `app-shell.css`, `global-command.css`, `timesheet.css`.
- Удалены слой алиасов переменных (`--text`, `--primary`…) и частные палитры (`--chat-*`, `--cp-*`). Около 130 захардкоженных цветов заменены токенами (в TSX — все).
- 194 кнопки переведены на `Button`, 42 нативных select — на `Select`, 32 `status-pill` — на `StatusBadge`, 23 `inline-notice` — на `Alert`, 36 подписей полей — на `Field`.
- `body` использует `--ui-font-sans` (Inter) вместо Aptos.

## 4. Что осталось и как переносить

1. **Legacy-кит в globals** (`page-card`, `page-muted`, `section-title`, `detail-*`, `action-row`, `workspace-*`, `record-card`): ~800 использований. Переносить постранично на `Surface`, `PageHeader`, `FactStrip`, `Stack`, `EmptyState`; удалять классы, когда исчезнет последнее использование (аудит покажет).
2. **Доменные блоки в globals** (календарь заказов, обзор табеля, чаты, реестр/карточка заказа, задачи, подотчёт, склад, просмотр файлов): переносить в CSS-модули своих фич вместе с заменой `className="…"` на `styles.…`.
3. **149 нативных `<button>`**: в основном контролы со своей вёрсткой (ячейки календарей, чипы, пункты меню). Переводить на `Button`/`IconButton`, где это обычные действия.
4. **218 inline-стилей** в старых формах (разовый заказ, склад, подотчёт, менеджеры объекта) → `Stack`, `Field`, CSS-модуль формы.
5. **Собственные фильтры** в контрагентах и согласованиях → `RegistryToolbar`.

## 5. Проверка

Скрипт аудита (Python, однофайловый) ищет классы из CSS без упоминаний в `.ts/.tsx`. Для модулей он сопоставляет `styles.x`, для глобальных классов — литералы и префиксы шаблонов (`ui-badge--${…}`). Если появятся мёртвые классы, удалить их и проверить, что браузер разобрал столько же правил, сколько postcss: незакрытый комментарий молча «съедает» правила до следующего `*/`.
