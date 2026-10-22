# Откуда берётся визуал страниц (frontend)

Актуально на 2026-10-22. Порядок каскада задаёт `apps/frontend/src/app/layout.tsx`.

## 1. Слои стилей

| # | Источник | Что в нём | Владелец |
|---|----------|-----------|----------|
| 1 | `app/globals.css` (~1.3k строк) | Базовые стили тегов (reset, `html/body` — базовый размер текста 14 px, у `input[type=number]` скрыты стрелки, `a`, нативные `button/input/textarea`), оформление `searchable-select`, классы, которые читают DOM-запросы (`chat-message`, `chat-room-menu`, `timesheet-object-detail`…) или стилизуют чужие модули через `:global()` (вложения, уведомления, реестр объектов) | общий |
| 2 | `shared/styles/design-tokens.css` | Только `--ui-*` токены | дизайн-система |
| 3 | `shared/styles/ui-foundation.css` | Классы `.ui-*` компонентов foundation и утилиты раскладки (`ui-page`, `ui-inline`, `ui-section-*`, `ui-detail-*`, `ui-text-muted`, `ui-surface--padded/compact`). Утилиты и `Surface` объявлены через `:where()` — нулевая специфичность, любой класс раздела их переопределяет | дизайн-система |
| 4 | `shared/styles/app-shell.css` | Сайдбар, шапка, область контента | shell |
| 5 | `shared/styles/global-command.css` | Глобальный поиск и «+» в шапке | shell |
| 6 | Модули `shared/ui/*` | Общие компоненты: date-picker, searchable-select, data-table (+ `SortableHeader`), registry-filters (+ `RegistryDateRange`), overlays, phone-list-field, user-avatar, media-entry… | компонент |
| 7 | Модули `entities/*/ui/*` | Стили сущности, общие для нескольких фич: `task-ui`, `one-time-order-ui`, `timesheet-ui` | сущность |
| 8 | Модули `features/*/ui/*` | Раскладка фичи (карточки сотрудника, кандидата, календарь заказов, подотчёт, кандидаты…) | фича |
| 9 | Модули `app/(app)/**` | Раскладка страницы (чаты, контрагенты, согласования, объекты, склад, просмотр файла) | страница |
| 10 | Inline `style={{…}}` | ~210 мест раскладки в старых формах; цвета запрещены линтером | — |
| 11 | Стили из JS | Цвет аватара `UserAvatar`, позиция поповеров, тон `StatusBadge` по коду статуса | компонент |

## 2. Матрица «элемент → компонент → стили»

| Элемент | Использовать | Не использовать (запрещено ESLint) |
|---|---|---|
| Кнопка | `Button` (`variant`, `size`, `icon`, `pending`) | `.button-secondary/-danger/-quiet`, `.quiet-button`, локальные `primaryButton/…` |
| Ссылка-кнопка, «Создать …» | `ButtonLink` (`variant="primary" icon={<PlusIcon />}`) | `.button-link` |
| Иконка-кнопка | `IconButton` (`bordered` рядом с кнопками шапки) | — |
| Иконки | `shared/ui/icons` | локальные SVG-функции |
| Выпадающий список | `SearchableSelect` / `SelectField` / `Select` | нативный `<select>` |
| Дата / период | `DatePicker`, `RegistryDateRange` | `type="date"` |
| Поле с подписью | `Field` | `<label><div style={{marginBottom: 6}}>` |
| Телефоны | `PhoneListField` | — |
| Статус | `StatusBadge` / `Badge` | `.status-pill` |
| Сообщение | `Alert` | `.inline-notice`, красный inline-текст |
| Подтверждение / причина | `ConfirmDialog`, `ReasonDialog`, `useConfirm()`, `useReasonPrompt()` | `window.confirm/prompt/alert` |
| Карточка / секция | `Surface padding="md"` (`as="section"`…); элемент списка — `padding="sm"`; для `<form>`, `<details>`, `Link` — классы `ui-surface ui-surface--padded` | `.page-card`, `.workspace-surface`, `.record-card` |
| Возврат к родителю (подстраницы, карточки) | `BackLink` над контентом, без отдельного крупного заголовка | `PageTitle` в карточке сущности |
| Тело страницы | `className="ui-page"` / `Stack` | `.page-stack`, `.workspace-page` |
| Заголовок секции | `ui-section-header`, `ui-section-title`, `ui-section-subtitle` | `.section-*` |
| Подпись — значение | `FactStrip` (полоса фактов) или `ui-detail-grid/field/label/value` | `.detail-*` |
| Группа действий | `ui-inline` | `.action-row` |
| Вторичный текст | `ui-text-muted` | `.page-muted` |
| Пустое состояние / загрузка | `EmptyState`, `LoadingState` (или класс `ui-empty-state`) | `.workspace-empty` |
| Реестр | `RegistryToolbar` + `DataTable` + `SortableHeader` + `TablePagination` | собственные фильтры/сортировки |
| Шапка сущности | `BackLink`, `EntityHeader`, `UserAvatar variant="soft"`, `FactStrip`, `OverflowMenu` | — |
| Вкладки | `WorkspaceTabs` | самодельные `role="tablist"` |

## 3. Проверки

- `pnpm --filter frontend lint` = ESLint (правила выше) + `scripts/audit-css.mjs`: находит классы без использования и комментарии, «съевшие» правила.
- Новый стиль раздела — в модуль рядом с владельцем, не в `globals.css`.

## 4. Что осталось

1. **~100 нативных `<button>`**: в основном внутри общих компонентов (date-picker, registry-toolbar, searchable-select — это их реализация) и контролы со своей вёрсткой (ячейки календарей, строки чатов и дашборда, звёзды рейтинга).
2. **~210 inline-стилей** в старых формах: разовый заказ, склад, подотчёт, менеджеры объекта.
3. **Остаток `globals.css`**: `searchable-select`, классы вложений и уведомлений (их стилизуют другие модули), классы для DOM-запросов, базовые стили тегов.
