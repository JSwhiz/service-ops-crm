# Визуальный аудит CRM: найденные проблемы и решения

Дата проверки: 17 октября 2026 года
Среда: локальная CRM, `localhost:3000`
Роль в браузере: Учредитель
Режим: только просмотр; код, данные и production не менялись.

## Статус аудита

Выполнен широкий визуальный проход по основным реестрам, формам и карточкам. Это **не полный аудит всех 43 страниц для всех ролей**: в браузере была доступна только роль Учредителя. Карточки кандидата и файла нельзя было проверить без существующих записей. Снимки осматривались непосредственно в браузере, но отдельный архив снимков не создан.

Проверка прав остальных ролей остаётся незакрытой. Для неё нужны отдельные локальные тестовые аккаунты или безопасный способ переключать тестовую роль; production-аккаунты использовать не следует.

## Найденные проблемы и решения

### 1. Форма создания кандидата — нарушено выравнивание

**Наблюдение:** подписи и поля расположены несогласованно; поле комментария значительно меньше соседних полей и визуально выбивается из сетки.

**Решение:** привести форму к общей сетке полей CRM: единая высота контролов, подпись над полем, равные интервалы; комментарий разместить на всю ширину формы с нормальной минимальной высотой. На узком экране складывать поля в одну колонку. Перед закрытием проверить создание и валидацию в браузере.

**Приоритет:** высокий — форма создания.

### 2. Выбор исполнителей задачи — повторяются «Bootstrap Founder»

**Наблюдение:** в списке кандидатов исполнителей видны повторяющиеся элементы с одинаковым именем.

**Решение:** сначала установить источник дублей: тестовые записи, некорректное объединение пользователей или отсутствие дедупликации в запросе. Не скрывать записи только на клиенте, пока не подтверждена причина. Затем добавить проверку, что один и тот же пользователь показывается один раз, и тест для списка исполнителей.

**Приоритет:** высокий — влияет на назначение задач.

### 3. Карточка расходника — сводные показатели слипаются

**Наблюдение:** подписи и числа отображаются подряд, например «Все движения10»; категории движения также трудно быстро разобрать.

**Решение:** оформить показатели как отдельные пары «подпись — значение» в адаптивной сетке или компактных строках. Проверить длинные подписи, нулевые значения и мобильную ширину.

**Приоритет:** высокий — читаемость складских данных.

### 4. Отчёт по расходникам — неоднозначные метрики и архивные позиции

**Наблюдение:** в отчёте одновременно показаны удалённые позиции; метрика «Без фото — ждут согласования» не объясняет, что именно ожидает решения.

**Решение:** явно разделить активные позиции и архив/удалённые (например, фильтром или отдельным блоком). Переименовать метрику на понятную бизнесу формулировку и пояснить, какие операции попадают в число. Не убирать исторические записи, если они нужны для аудита.

**Приоритет:** средний; до правки терминов подтвердить бизнес-смысл и источник счётчика.

### 5. Реестр сотрудников — колонки и значения обрезаются

**Наблюдение:** таблица содержит много колонок; подписи и данные не помещаются в доступную ширину.

**Решение:** сохранить важные для быстрого выбора сведения в основной таблице, второстепенные перенести в карточку или раскрываемый просмотр. Для таблицы предусмотреть осмысленные ширины, перенос/обрезку с доступным полным значением и адаптивное поведение. Не уменьшать шрифт до нечитаемого размера.

**Приоритет:** высокий — ежедневный реестр.

### 6. Настройки — заглушка вместо функционального раздела

**Наблюдение:** страница сообщает, что настройки пользователя, доступа и системы появятся позже.

**Решение:** пока раздел не реализован, не представлять его как действующий модуль: скрыть из навигации для ролей, которым там нечего делать, либо показать аккуратную страницу «Раздел пока недоступен» с объяснением и ссылкой назад. Реализацию самих настроек планировать отдельно.

**Приоритет:** средний.

### 7. Табель — широкая месячная сетка

**Наблюдение:** дни месяца не помещаются по горизонтали в один экран.

**Решение:** оставить горизонтальную прокрутку как свойство календарной таблицы, но закрепить колонки объекта и сотрудника, сохранить видимость итогов и дать понятный визуальный признак продолжения таблицы. Проверить прокрутку мышью, трекпадом и на узком экране. Не сжимать 31 день до нечитаемых колонок.

**Приоритет:** средний; это не автоматически ошибка, важно качество прокрутки.

### 8. Календарь пользователей — видна часть месяца

**Наблюдение:** при текущем положении прокрутки виден диапазон дат около текущего дня, а не весь месяц.

**Решение:** проверить начальное позиционирование при первом открытии и после смены месяца. Якорить текущую дату можно, если пользователь сразу понимает, что календарь прокручивается; добавить подсказку/индикатор продолжения и обеспечить навигацию по месяцу. Убедиться, что выбранный день не скрывает начало периода.

**Приоритет:** средний.

### 9. Визуальные различия между компонентами

**Наблюдение:** основной синий акцент заметен и в целом выдержан, но отдельные кнопки и состояния имеют разные оттенки/контраст.

**Решение:** сравнить кнопки по общим токенам темы, а не исправлять оттенки локально на отдельных страницах. Проверить primary/secondary/danger, disabled, focus и hover состояния на реестрах, формах и карточках.

**Приоритет:** средний; сначала определить источник расхождений в общих стилях.

## Что выглядит последовательно

- Реестры объектов, контрагентов, расходников и разовых заказов используют понятную структуру поиска, фильтров и таблицы.
- Карточка объекта имеет заметную верхнюю сводку и навигацию по разделам.
- Карточка разового заказа и раздел команды визуально разделяют основные рабочие задачи.
- Карточка сотрудника структурирована лучше, чем реестр сотрудников.

## Следующий порядок работ

1. Устранить смещение полей в форме кандидата и проверить адаптивность.
2. Разобраться с дублями исполнителей и подтвердить источник данных.
3. Исправить структуру показателей в карточке расходника.
4. Уточнить смысл метрики отчёта и определить показ архивных позиций.
5. Упростить реестр сотрудников без потери важных данных.
6. Проверить горизонтальную навигацию табеля и стартовое положение календаря.
7. Согласовать поведение заглушки настроек и привести состояния кнопок к общим токенам.
8. Провести ролевую проверку по всем 43 страницам на локальных тестовых аккаунтах и отдельно закрыть динамические карточки кандидата и файла.

## Границы этого документа

Это фиксация наблюдений и предлагаемых решений, а не запись об исправлении. Никакие изменения кода или данных не выполнялись. Ролевые права, полный набор страниц и все состояния компонентов пока не считаются проверенными.

## Продолжение работ — 17 октября 2026 года

### Проверка формы ставки и логики графика

- В коде формы «Новый вариант оплаты» уже есть шаблон графика (`5/2` и другие) и выбор рабочих дней недели; оба значения отправляются в API. Поэтому отсутствие этих полей на приложенном скриншоте не подтверждается текущим исходным кодом. Наиболее вероятно, что браузер показывает устаревший frontend, но это остаётся гипотезой: свежий визуальный проход выполнить не удалось.
- API допускает одновременно `scheduleCode` и непустой `scheduleWeekdays`; расчёт отдаёт приоритет выбранным дням. Нужно закрепить взаимоисключающий режим «шаблон графика / конкретные дни» в форме и API, чтобы отображаемый график совпадал с тем, по которому считается оклад.
- Найден более серьёзный риск в тарифах объекта: основные поля оплаты используются как активная проекция и могут перезаписываться летним/зимним тарифом. Это не гарантирует сохранение независимого базового тарифа. До миграции нужно определить безопасную обработку существующих объектов, поскольку для сезонных объектов исходное базовое значение нельзя восстановить из текущей проекции автоматически.
- Проверки кода показывают, что менеджер видит тарифы без управления ими, а тарифами могут управлять руководящие роли и `deputy_director`. Полная HTTP-матрица разрешений для всех этих ролей пока не покрыта.

### Первые общие визуальные исправления

- Общая таблица и навигация по вкладкам переведены с локальных бежевых цветов на существующие семантические токены CRM. Изменены `shared/ui/data-table/data-table.module.css` и `shared/ui/workspace-tabs/workspace-tabs.module.css`.
- Эти изменения прошли frontend lint и typecheck, но визуально не подтверждены.

### Ограничения браузерной проверки

Во время этого прохода доступ управления браузером к `localhost:3000` был отклонён политикой браузерной безопасности. Другие браузеры, сетевые запросы и обходные способы для получения той же страницы не использовались. Поэтому полный аудит 43 страниц и всех ролей остаётся незавершённым; этот документ не утверждает обратного.
## Follow-up: schedule editor UX (2026-10-17)

### Implemented in the current working tree

- Object compensation profiles, the compensation-rate catalog, and individual employee rate forms now expose mutually exclusive `Стандартный график` and `Дни недели` modes.
- Existing records with explicit weekdays open in weekday mode, matching the current calculation priority. Custom weekday mode requires at least one selected day; the last selected day cannot be unchecked.
- Forms submit only the active schedule representation: a template with an empty weekday list, or a nullable template plus selected weekdays. Object create/edit validates all three profiles before submission.
- Schedule controls use the current UI token palette. Legacy hardcoded colors in the touched staffing panel styles were replaced with tokens.

### Verified

- Frontend ESLint and TypeScript typecheck pass.
- `timesheet-monthly-salary-rate.test.ts`: 7 tests pass; these confirm existing weekday-over-template calculation behavior.
- `git diff --check` passes.
- No browser screenshot was captured in this pass, so visual rendering is not browser-verified.

### Still open; do not treat as implemented

- Standard schedule templates currently count weekdays by a simple weekly rule; the calculation does not apply the official Russian production calendar, public holidays, or transferred working days. This can change planned denominators and newly calculated monthly amounts. Define supported template semantics and calendar coverage before changing payroll calculations; preserve saved timesheet snapshots.
- Backend DTOs still allow a caller to submit both a schedule template and weekdays. The updated UI does not submit both, and the existing calculation intentionally gives weekdays priority. Decide whether to reject/normalize conflicting API payloads without breaking legacy records before adding server-side enforcement.
- Changing the selected UI mode clears the inactive draft selection. The user must reselect it if switching back before saving.

## Follow-up: confirmed schedule semantics and palette migration (2026-10-17)

### Schedule semantics confirmed by the user

- `5/2` is a standard schedule calculated against the official production calendar, including holidays and transferred working days.
- Templates `1/6`, `2/5`, `3/4`, `4/3`, `6/1`, `7/0` are repeating work/rest cycles and require a saved cycle start date. The weekday-selection mode remains separate and counts the selected weekdays in the month.
- This is a product decision, not yet an implementation. Correct support requires persisting the cycle anchor anywhere a schedule is stored (object base/summer/winter profiles, rate catalog and individual assignment policy) and carrying it into calculation snapshots. Existing saved timesheet values must remain unchanged. Current calculation still treats templates as fixed weekdays and does not use a production calendar or cycle anchor.

## Implementation update: schedule semantics (2026-10-17)

The schedule behavior above is now implemented in the current working tree; the historical notes are retained as an audit trail, not as the current status.

- `5/2` uses a versioned Russian production calendar (currently 2026 and 2027). The applicable calendar version is stored in newly calculated timesheet rate snapshots. Old snapshots without a version continue using the old Monday–Friday interpretation, so saved historical calculations are not silently changed.
- `1/6`, `2/5`, `3/4`, `4/3`, `6/1`, and `7/0` are repeating seven-day work/rest cycles. Their first working day is persisted for object base/summer/winter profiles, compensation catalog options, and individual employee rate policies.
- Literal weekday mode and template mode are mutually exclusive in the frontend and API. A cycle template without its start date and an API request that combines a template with selected weekdays are rejected. Selecting weekdays clears the template and cycle date; selecting a template clears weekday selections.
- Existing dual-mode rows are migrated to their former effective mode (weekdays had priority). Existing cycle rows without an anchor are anchored on Monday, preserving their previous Monday-based weekly pattern.
- The object create/edit forms, object team rate catalog, and employee rate editor show the cycle date only for cycle templates; `5/2` explicitly identifies the production-calendar rule.

### Verification

- Backend and frontend TypeScript checks and ESLint pass.
- Unit tests pass for production-calendar holidays/transfers, cycle boundaries, invalid configuration, monthly calculations, and legacy snapshot compatibility.
- The object compensation integration suite passes in an isolated local schema, including cycle option creation/assignment and API rejection of invalid schedule combinations.
- Browser inspection on local `localhost:3000` confirmed the object form and team rate form reveal the required start-date field for `2/5`; switching to weekday mode removes template/date controls. No object data was saved during this check.
- Production calendar data is only bundled through 2027. Calculations for a later year fail explicitly until its official calendar is added; they do not silently fall back to an inaccurate weekday estimate.
- The migration was applied successfully to the local development database at `127.0.0.1:55432`; no production database was accessed or changed.
- These changes remain uncommitted and undeployed. The separate full palette migration and full 43-page/all-role audit are not certified complete by this schedule check.

### Palette work in the current working tree

- Replaced repeated warm-neutral values with the existing `--ui-*` surface, text, border and accent tokens in shared styles and page styles, including approvals, dashboards, object and order workspaces, equipment and period controls.
- Mapped repeated legacy status colors to semantic danger, warning and success tokens; status meaning remains distinct from the blue brand accent.
- The app-shell active navigation outline now uses the common border token. Its active fill/text continue to use the configured blue accent tokens.
- This is a tokenization pass, not proof that every one-off CSS value across all 43 routes has been removed. Remaining literals include white surfaces, some local semantic colors and less common legacy shades; a route-by-route residual scan and visual review are still needed.
- Frontend lint and typecheck pass after these changes. No fresh screenshot was captured, so the palette is not browser-visually verified in this pass.

### Palette follow-up details

- Extended token usage to legacy/global form focus states, account summary surfaces, one-time-order status pills, login form, month picker, searchable select, shared dashboard health indicators, and the object registry table.
- Replaced remaining old brown focus outlines and shadows found in the touched shared/page styles; converted repeated old success/warning/error shades to semantic tokens.
- Browser inspection confirms `localhost:3000/dashboard` is currently rendering the CRM and its navigation/content tree. This is a live-page availability check only: no screenshot or computed-style inspection was available, so it does not establish visual correctness or confirm the active-nav color winner in the browser.
- This remains a broad migration pass, not a complete CSS cleanup: several unrelated legacy literals and one-off states remain. The palette work is not considered fully closed until the residual scan and route-by-route visual review are completed.
