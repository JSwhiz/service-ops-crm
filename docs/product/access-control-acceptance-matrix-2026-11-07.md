# Поимённая матрица приёмки прав — 7 ноября 2026

Это реестр доказательств, а не заявление, что все права работают. Он заменяет общий ответ «всё проверено» поимённым статусом для **каждого из 291 действия действующего каталога**. Строки с одинаковым названием различаются полным кодом.

## Итог

| Статус | Прав |
| --- | ---: |
| подтверждено | 0 |
| проверено частично | 84 |
| не проверено | 199 |
| не реализовано | 8 |
| **Всего** | **291** |

**Полная приёмка не завершена.** Даже наиболее подробно проверенные действия остаются частичными: нет сквозной браузерной проверки от имени получателя для каждого права, всех применимых областей и каналов. Ноль подтверждённых прав не означает, что система не работает: это означает, что полный стандарт доказательств ещё не выполнен.

В этом проходе выполнены только чтение и сопоставление каталога, кода и ранее записанных результатов, затем проверка полноты этого документа. **Тестовые наборы, HTTP, БД и браузер не запускались; приложение, права пользователей и сервер не менялись.** Результаты ниже относятся к предыдущим локальным прогонам, а не к новому запуску или серверной приёмке.

## Снимок и границы

- Ветка: `feat/access-control-2026-11-06`; исходный checkpoint: `6c02501`. Рабочее дерево содержит незакоммиченные изменения предыдущей реализации.
- Каталог: [access-action-catalog.ts](../../apps/backend/src/modules/users-access/access-action-catalog.ts), SHA-256: `991e8a4a4e4768bea7d277e670cb55fafae028ae6bd7d8c3fba075e64957313d`.
- Машиночитаемый реестр: [JSON с 291 строкой, областями, ограничениями и ссылками](access-control-acceptance-matrix-2026-11-07.json).
- Ранее записанные результаты и ограничения: [общий реестр реализации](access-control-enforcement-2026-11-07.md). Его 129 unit/service, 122 интеграционных и 16 frontend-проверок — **число тестов, а не подтверждённых прав**; повторные прогоны не складываются заново.
- Статические ссылки в строках показывают место для обследования. Литерал кода права в файле, наличие тестового файла и общий успешный прогон не доказывают сквозную работоспособность отдельного права.
- JSON содержит до восьми найденных файлов каждого вида на право; это навигационная выборка, не полный граф потребителей. Отсутствие буквального упоминания не доказывает отсутствие реализации: родительские проверки могут строиться динамически.
- Каталог охвачен полностью. Все динамические проверки, фактический набор разрешений серверной БД и каждую жёсткую ролевую ветвь этим проходом **не сертифицировали**. Их нельзя объявить проверенными по совпадению строк.

## Как читать статусы

- **подтверждено** — Применимые К1–К7 закрыты адресными воспроизводимыми результатами, включая интерфейс получателя и независимую перепроверку.
- **проверено частично** — Есть адресное ограниченное доказательство; конкретный объём и пробелы указаны в evidence.
- **не проверено** — Достаточное адресное доказательство в этом реестре не установлено. Наличие реализации или тестового файла не меняет статус.
- **не реализовано** — Каталог явно отключает самостоятельную операцию. См. replacements; связанная функция может существовать.

«Новая выдача закрыта» — отдельная характеристика, не пятый статус. Таких действий 16: операция по прежним полномочиям может работать, но новый персональный allow сейчас не должен расширять круг полномочных. Это ограничение должно быть понятно в окне учредителя; обходить его обычным переключателем нельзя.

## Критерии полной приёмки

- **К1.** Allow, deny и возврат к default с базовыми ролями; запрет имеет приоритет.
- **К2.** Все применимые области и контрольный ресурс; выбранный grant не создаёт назначения/владения/членства.
- **К3.** Прямой API и фактический DTO/запись. При отказе нет доменных, денежных, складских, исторических и событийных эффектов.
- **К4.** Реальная сессия получателя: меню, кнопка, форма, причина запрета, длинные значения, размеры экрана; учредитель не заменяет получателя.
- **К5.** Выдача/отзыв в уже открытой сессии, черновике и меню; устаревшие ответы/повтор запроса не обходят отзыв.
- **К6.** Родительские ограничения и применимые вложенные DTO, файлы, история, поиск, экспорт, уведомления, realtime.
- **К7.** Жизненный цикл, закрытые периоды, независимость согласования, денежные/складские инварианты, повторы и гонки; независимое ревью.

Неприменимость критерия фиксируется с причиной, а не молчаливо считается успехом. Для чувствительных полномочий вместо запрещённой новой выдачи проверяются сохранение прежнего круга, персональные запреты и честный отказ preview. Области «свои/назначенные/выбранные/все» относятся к указанному типу ресурса: «все» само по себе не отменяет родителей, членство, назначение, активность и бизнес-инварианты.

Чтобы поднять строку в «подтверждено», нужны: дата и снимок кода; актор/роль без секретов; действие и ресурс A/контроль B; входные правила и ожидаемый результат; команда/сценарий; фактический API/DTO/эффекты и браузерный результат; ссылки на доказательства; применимость К1–К7 и независимая перепроверка. Любой провал остаётся явно открытым.

## Сводка по разделам

| Раздел | Всего | Подтверждено | Частично | Не проверено | Не реализовано |
| --- | ---: | ---: | ---: | ---: | ---: |
| Рабочий стол | 6 | 0 | 0 | 6 | 0 |
| Объекты | 47 | 0 | 22 | 24 | 1 |
| Разовые заказы | 41 | 0 | 8 | 33 | 0 |
| Календарь разовых заказов | 7 | 0 | 0 | 6 | 1 |
| Каталог ТЗ | 5 | 0 | 0 | 5 | 0 |
| Контрагенты | 10 | 0 | 5 | 5 | 0 |
| Склад и расходники | 17 | 0 | 12 | 5 | 0 |
| Оборудование | 17 | 0 | 2 | 14 | 1 |
| Ковры | 7 | 0 | 2 | 5 | 0 |
| Задачи | 16 | 0 | 0 | 15 | 1 |
| Табель | 9 | 0 | 3 | 4 | 2 |
| Подотчёт | 15 | 0 | 3 | 12 | 0 |
| Отсутствия и календарь пользователей | 8 | 0 | 0 | 8 | 0 |
| План посещений | 6 | 0 | 5 | 1 | 0 |
| Замещения | 5 | 0 | 0 | 5 | 0 |
| Кандидаты | 12 | 0 | 1 | 11 | 0 |
| Сотрудники | 13 | 0 | 2 | 11 | 0 |
| Согласования | 8 | 0 | 4 | 4 | 0 |
| Чаты | 19 | 0 | 4 | 15 | 0 |
| Уведомления | 5 | 0 | 3 | 2 | 0 |
| Поиск | 3 | 0 | 2 | 1 | 0 |
| Файлы | 7 | 0 | 4 | 2 | 1 |
| Вход и сессия | 5 | 0 | 0 | 5 | 0 |
| Настройки | 1 | 0 | 0 | 0 | 1 |
| Пользователи и доступы | 2 | 0 | 2 | 0 | 0 |

## Поимённые строки

В колонке «Доказательства» указаны ссылки E01–E19 на ограниченный сценарий ниже, **не отметка закрытия всех К1–К7**. «—» означает отсутствие принятого адресного доказательства в этом реестре, даже если тест-кандидат существует. Навигационные ссылки на такие тесты сохранены в JSON отдельно от доказательств успешного прогона.

Общее незакрытое условие для всех действующих строк — К1–К7 в применимой части. Колонка «Что проверить следующим» задаёт адресный следующий шаг, а не сокращает полный набор критериев.

### Рабочий стол

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Рабочий стол<br>`dashboard.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L265) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр рабочего стола<br>`dashboard.view`<br>[код](../../apps/backend/src/modules/dashboard/dashboard-access.util.ts#L68) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Рабочий стол руководства<br>`dashboard.leadership.view`<br>[код](../../apps/backend/src/modules/users-access/utils/legacy-access-projection.util.ts#L780) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Рабочий стол менеджера<br>`dashboard.manager.view`<br>[код](../../apps/backend/src/modules/users-access/utils/legacy-access-projection.util.ts#L785) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Рабочий стол HR<br>`dashboard.hr.view`<br>[код](../../apps/backend/src/modules/users-access/utils/legacy-access-projection.util.ts#L796) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Рабочий стол операционного менеджера<br>`dashboard.operations.view`<br>[код](../../apps/backend/src/modules/users-access/utils/legacy-access-projection.util.ts#L792) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Объекты

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Объекты<br>`objects.access`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L89) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E02](#e02), [E13](#e13), [E15](#e15), [E16](#e16) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр объекта<br>`objects.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L89) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E05](#e05), [E13](#e13), [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Создание объекта<br>`objects.create`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L424) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение объекта<br>`objects.update`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L3286) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение статуса<br>`objects.status`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L1222) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E08](#e08) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Заморозка объекта<br>`objects.freeze`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L429) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E08](#e08) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Архивирование объекта<br>`objects.archive`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L428) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E08](#e08) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Восстановление объекта<br>`objects.restore`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L1220) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E08](#e08) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Ответственные объекта<br>`objects.responsibles.manage`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L1488) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Менеджеры объекта<br>`objects.managers.manage`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L1602) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| История объекта<br>`objects.history`<br>[код](../../apps/backend/src/modules/objects/objects.service.ts#L359) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Чтение контактов<br>`objects.contacts.read`<br>[код](../../apps/backend/src/modules/objects/object-planning.service.ts#L104) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E04](#e04) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Изменение контактов<br>`objects.contacts.manage`<br>[код](../../apps/backend/src/modules/objects/object-planning.service.ts#L117) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E08](#e08) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Чтение материалов<br>`objects.materials.read`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L873) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E04](#e04), [E12](#e12) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Материалы и инструкции<br>`objects.materials.manage`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L950) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E02](#e02), [E08](#e08) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Чтение фото прибытия<br>`objects.arrival.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L20) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Фото прибытия<br>`objects.arrival.create`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L950) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Чтение отчётов<br>`objects.reports.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L21) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Черновик отчёта<br>`objects.reports.update`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L368) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отправка отчёта<br>`objects.reports.submit`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L378) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Исправление вложений отчёта<br>`objects.reports.attachments.correct`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L405) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Чтение комментариев<br>`objects.comments.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L22) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Комментарий объекта<br>`objects.comments.create`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L951) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр состава<br>`objects.staffing.read`<br>[код](../../apps/backend/src/modules/dashboard/dashboard-access.util.ts#L178) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E04](#e04) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Изменение состава<br>`objects.staffing.manage`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L3278) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр посещаемости<br>`objects.attendance.read`<br>[код](../../apps/backend/src/modules/dashboard/leadership-dashboard.service.ts#L490) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отметки посещаемости<br>`objects.attendance.edit`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L1795) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр ставок<br>`objects.rates.read`<br>[код](../../apps/backend/src/modules/approvals/utils/approval-read-access.util.ts#L191) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E05](#e05), [E13](#e13) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Управление ставками<br>`objects.rates.manage`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L3299) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E06](#e06) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр бюджета<br>`objects.budget.read`<br>[код](../../apps/backend/src/modules/object-scheduling/object-compensation.service.ts#L53) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E05](#e05) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Изменение бюджета<br>`objects.budget.edit`<br>[код](../../apps/backend/src/modules/object-scheduling/object-compensation.service.ts#L92) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E06](#e06) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Коэффициент<br>`objects.coefficient.edit`<br>[код](../../apps/backend/src/modules/objects/object-setup.service.ts#L96) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Договорная сумма<br>`objects.contract_amount.read`<br>[код](../../apps/backend/src/modules/objects/object-setup.service.ts#L88) | проверено частично | свои, назначенные, выбранные, все | Руководящий круг | [E18](#e18) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Настройки планирования<br>`objects.planning.manage`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не реализовано | свои, назначенные, выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |
| Просмотр позиций и графика<br>`objects.schedules.read`<br>[код](../../apps/backend/src/modules/object-scheduling/object-scheduling.service.ts#L32) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Позиции и группы графика<br>`objects.schedules.manage`<br>[код](../../apps/backend/src/modules/object-scheduling/object-scheduling.service.ts#L39) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выбор готового условия оплаты<br>`objects.pay_conditions.select`<br>[код](../../apps/backend/src/modules/object-scheduling/object-scheduling.service.ts#L48) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Расшифровка начислений<br>`objects.compensation.read`<br>[код](../../apps/backend/src/modules/approvals/utils/approval-read-access.util.ts#L184) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E05](#e05) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Версии условий и фонд команды<br>`objects.compensation.manage`<br>[код](../../apps/backend/src/modules/object-scheduling/object-compensation.service.ts#L31) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E06](#e06) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Допработа и цена выхода<br>`objects.compensation.adjust`<br>[код](../../apps/backend/src/modules/object-scheduling/object-compensation.service.ts#L76) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E10](#e10) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Заявка на прошлое исправление<br>`objects.compensation.correct_past`<br>[код](../../apps/backend/src/modules/object-scheduling/object-compensation.service.ts#L92) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Расходники объекта<br>`objects.inventory.read`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1158) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выдача расходников на объект<br>`objects.inventory.issue`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L2094) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Оборудование объекта<br>`objects.equipment.read`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L960) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Связанные заказы<br>`objects.linked_orders.read`<br>[код](../../apps/backend/src/modules/object-operations/object-operations.service.ts#L740) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| HR-просмотр отчётов<br>`objects.hr_reports_view`<br>[код](../../apps/backend/src/common/access/notification-source-visibility.ts#L61) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| HR-профиль объекта<br>`objects.view_hr`<br>[код](../../apps/backend/src/common/access/notification-source-visibility.ts#L54) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |

### Разовые заказы

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Разовые заказы<br>`one_time_orders.access`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L89) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E14](#e14) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр заказа<br>`one_time_orders.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L89) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E14](#e14) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Создание заказа<br>`one_time_orders.create`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L826) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение заказа<br>`one_time_orders.update`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L952) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Копирование заказа<br>`one_time_orders.copy`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L991) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Статус заказа<br>`one_time_orders.status`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2170) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Завершение заказа<br>`one_time_orders.complete`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2263) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Повторное открытие<br>`one_time_orders.reopen`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2404) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Менеджеры заказа<br>`one_time_orders.managers.manage`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2784) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Финансы заказа<br>`one_time_orders.finance.read`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L202) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Регистрация оплаты<br>`one_time_orders.payments.create`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2266) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Исправление оплаты<br>`one_time_orders.payments.correct`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2511) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| История заказа<br>`one_time_orders.history`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L3312) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение отзыва<br>`one_time_orders.review.edit`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L1386) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление отзыва<br>`one_time_orders.review.delete`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L1455) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Все отзывы<br>`one_time_orders.review.view_all`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L605) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Чтение комментариев<br>`one_time_orders.comments.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L24) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Добавление комментария<br>`one_time_orders.comments.create`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L952) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр отчёта<br>`one_time_orders.reports.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L23) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Изменение отчёта<br>`one_time_orders.reports.update`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L953) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр фото<br>`one_time_orders.photos.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L25) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Добавление фото<br>`one_time_orders.photos.create`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L953) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление фото<br>`one_time_orders.photos.delete`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L3183) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Восстановление фото<br>`one_time_orders.photos.restore`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L3248) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр ТЗ<br>`one_time_orders.specification.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L26) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Состав и текст ТЗ<br>`one_time_orders.specification.manage`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L1634) | проверено частично | свои, назначенные, выбранные, все | Новая выдача закрыта | [E18](#e18) | Legacy/deny, запрет новой выдачи, UI и независимость |
| Выполнение пункта ТЗ<br>`one_time_orders.specification.execute`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L2023) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Комментарии пункта ТЗ<br>`one_time_orders.specification.comments`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L1553) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Вложения пункта ТЗ<br>`one_time_orders.specification.attachments`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L954) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отвязка вложения ТЗ<br>`one_time_orders.specification.detach`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L1600) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Состав команды заказа<br>`one_time_orders.employees.read`<br>[код](../../apps/backend/src/modules/dashboard/manager-dashboard.service.ts#L492) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение команды<br>`one_time_orders.employees.manage`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-workforce.service.ts#L183) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Договорные суммы сотрудника<br>`one_time_orders.employees.payment.edit`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-workforce.service.ts#L233) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Посещаемость заказа<br>`one_time_orders.attendance.read`<br>[код](../../apps/backend/src/modules/dashboard/manager-dashboard.service.ts#L498) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отметки посещаемости заказа<br>`one_time_orders.attendance.edit`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-workforce.service.ts#L462) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Табель заказа<br>`one_time_orders.timesheet.read`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-workforce.service.ts#L612) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выгрузка табеля заказа<br>`one_time_orders.timesheet.export`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-workforce.service.ts#L762) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выплаты по заказу<br>`one_time_orders.payouts.read`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L203) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Расходники заказа<br>`one_time_orders.inventory.read`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1290) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Оборудование заказа<br>`one_time_orders.equipment.read`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-orders.service.ts#L3380) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Сопровождающие<br>`one_time_orders.escorts.manage`<br>[код](../../apps/backend/src/modules/one-time-orders/utils/one-time-order-capabilities.util.ts#L268) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Календарь разовых заказов

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Календарь разовых заказов<br>`one_time_order_calendar.access`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-calendar.service.ts#L625) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр календаря заказов<br>`one_time_order_calendar.read`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L433) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выгрузка календаря<br>`one_time_order_calendar.export`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-calendar.service.ts#L68) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Управление календарём<br>`one_time_order_calendar.manage`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не реализовано | свои, выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |
| Своя доступность<br>`one_time_order_calendar.availability.own`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-manager-availability.service.ts#L88) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Доступность менеджеров<br>`one_time_order_calendar.availability.manage`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-manager-availability.service.ts#L320) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Согласование доступности<br>`one_time_order_calendar.availability.approve`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L405) | не проверено | свои, выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |

### Каталог ТЗ

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Каталог ТЗ<br>`specification_catalog.access`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-specification-catalog.service.ts#L320) | не проверено | все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Чтение каталога<br>`specification_catalog.read`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-specification-catalog.service.ts#L301) | не проверено | все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Создание пункта или шаблона<br>`specification_catalog.create`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-specification-catalog.service.ts#L55) | не проверено | все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Изменение пункта или шаблона<br>`specification_catalog.update`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-specification-catalog.service.ts#L306) | не проверено | все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Архивирование пункта или шаблона<br>`specification_catalog.archive`<br>[код](../../apps/backend/src/modules/one-time-orders/one-time-order-specification-catalog.service.ts#L125) | не проверено | все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |

### Контрагенты

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Контрагенты<br>`counterparties.access`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L646) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр контрагента<br>`counterparties.read`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L638) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание контрагента<br>`counterparties.create`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L229) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение контрагента<br>`counterparties.update`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L216) | проверено частично | выбранные, все | Персональное правило | [E09](#e09) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Архивирование<br>`counterparties.archive`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L218) | проверено частично | выбранные, все | Персональное правило | [E09](#e09) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Восстановление<br>`counterparties.restore`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L219) | проверено частично | выбранные, все | Персональное правило | [E09](#e09) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| История контрагента<br>`counterparties.history`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L460) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Связь с объектом<br>`counterparties.objects.link`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L217) | проверено частично | выбранные, все | Персональное правило | [E09](#e09) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Мастер-объект<br>`counterparties.master_object.manage`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L220) | проверено частично | выбранные, все | Персональное правило | [E09](#e09) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Агрегированная история расходников<br>`counterparties.inventory.read`<br>[код](../../apps/backend/src/modules/counterparties/counterparties.service.ts#L559) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Склад и расходники

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Склад<br>`inventory.access`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1291) | проверено частично | выбранные, все | Персональное правило | [E14](#e14) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр каталога<br>`inventory.read`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L401) | проверено частично | выбранные, все | Персональное правило | [E14](#e14) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Создание номенклатуры<br>`inventory.catalog.create`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L478) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение номенклатуры<br>`inventory.catalog.update`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L535) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Удаление номенклатуры<br>`inventory.catalog.delete`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L653) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Восстановление номенклатуры<br>`inventory.catalog.restore`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L762) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| История движений<br>`inventory.movements.read`<br>[код](../../apps/backend/src/common/access/resource-access-context.ts#L112) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Приход<br>`inventory.receipt`<br>[код](../../apps/backend/src/modules/inventory/utils/inventory-capabilities.util.ts#L59) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Выдача на объект<br>`inventory.issue_to_object`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L2101) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Отгрузка в разовый заказ<br>`inventory.issue_to_one_time_order`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1300) | проверено частично | назначенные, выбранные, все | Персональное правило | [E07](#e07), [E14](#e14) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Возврат<br>`inventory.return`<br>[код](../../apps/backend/src/modules/inventory/utils/inventory-capabilities.util.ts#L60) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Списание<br>`inventory.writeoff`<br>[код](../../apps/backend/src/modules/inventory/utils/inventory-capabilities.util.ts#L60) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Корректировка остатка<br>`inventory.adjustment`<br>[код](../../apps/backend/src/modules/inventory/utils/inventory-capabilities.util.ts#L61) | проверено частично | выбранные, все | Персональное правило | [E07](#e07) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Исправление выдачи<br>`inventory.movement.correct`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L200) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Складские отчёты<br>`inventory.reports`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1012) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Исключение без фото<br>`inventory.resolve_missing_photo`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1054) | проверено частично | выбранные, все | Только директор | [E18](#e18) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Выбор складских целей<br>`inventory.references.read`<br>[код](../../apps/backend/src/modules/inventory/inventory.service.ts#L1876) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Оборудование

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Оборудование<br>`equipment.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L61) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр оборудования<br>`equipment.read`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L910) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Каталог оборудования<br>`equipment.catalog.read`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L163) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание модели<br>`equipment.catalog.create`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L915) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление модели<br>`equipment.catalog.delete`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L210) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание единицы<br>`equipment.unit.create`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L321) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление ошибочной единицы<br>`equipment.unit.delete`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L379) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| История оборудования<br>`equipment.history`<br>[код](../../apps/backend/src/common/access/resource-access-context.ts#L126) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выдача на объект<br>`equipment.assign_object`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1240) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выдача на заказ<br>`equipment.assign_order`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1241) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Возврат<br>`equipment.return`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1242) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Перемещение<br>`equipment.move`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1247) | не реализовано | выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |
| Поломка<br>`equipment.broken`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1243) | проверено частично | выбранные, все | Персональное правило | [E10](#e10) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| В ремонт<br>`equipment.repair`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1244) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Из ремонта<br>`equipment.repair_return`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1245) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Утрата<br>`equipment.lost`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1246) | проверено частично | выбранные, все | Персональное правило | [E10](#e10) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Списание<br>`equipment.writeoff`<br>[код](../../apps/backend/src/modules/equipment/equipment.service.ts#L1248) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Ковры

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Ковры<br>`mats.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L222) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр ковров<br>`mats.read`<br>[код](../../apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.service.ts#L53) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Каталог размеров<br>`mats.catalog.read`<br>[код](../../apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.service.ts#L64) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание размера<br>`mats.catalog.create`<br>[код](../../apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.service.ts#L70) | проверено частично | все | Персональное правило | [E10](#e10) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Стоимость замены<br>`mats.cost.edit`<br>[код](../../apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.service.ts#L71) | проверено частично | все | Персональное правило | [E10](#e10) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Количество на объекте<br>`mats.quantity.edit`<br>[код](../../apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.service.ts#L55) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| История ковров<br>`mats.history`<br>[код](../../apps/backend/src/modules/rubber-mats/rubber-mat-aggregate.service.ts#L156) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Задачи

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Задачи<br>`tasks.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L230) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр задачи<br>`tasks.read`<br>[код](../../apps/backend/src/common/access/resource-access-context.ts#L47) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание задачи<br>`tasks.create`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L271) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение задачи<br>`tasks.update`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L955) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение статуса<br>`tasks.status`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L677) | не реализовано | свои, назначенные, выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |
| Исполнители<br>`tasks.assignees.manage`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1059) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отправка результата<br>`tasks.result.submit`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L692) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Черновик выполнения<br>`tasks.completion.draft`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L955) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отметка выполнения<br>`tasks.completion.submit`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L746) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отмена выполнения<br>`tasks.completion.undo`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L892) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Подтверждение результата<br>`tasks.confirm`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1366) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Немедленное завершение<br>`tasks.complete_now`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1366) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Возврат в работу<br>`tasks.return`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1435) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Повторное открытие<br>`tasks.reopen`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1435) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отмена задачи<br>`tasks.cancel`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1007) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| История задачи<br>`tasks.history`<br>[код](../../apps/backend/src/modules/tasks/tasks.service.ts#L1188) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Табель

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Табель объектов<br>`timesheet.access`<br>[код](../../apps/backend/src/modules/users-access/utils/access-summary.util.ts#L20) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр табеля<br>`timesheet.read`<br>[код](../../apps/backend/src/modules/approvals/utils/approval-read-access.util.ts#L213) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E03](#e03) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Сводный табель<br>`timesheet.overview`<br>[код](../../apps/backend/src/modules/timesheets/timesheets.service.ts#L577) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выгрузка табеля<br>`timesheet.export`<br>[код](../../apps/backend/src/modules/timesheets/timesheets.service.ts#L381) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Посещаемость<br>`timesheet.attendance.edit`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не реализовано | свои, назначенные, выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |
| Корректировка суммы в табеле<br>`timesheet.amount.edit`<br>[код](../../apps/backend/src/modules/timesheets/timesheets.service.ts#L1799) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E03](#e03) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Ручная корректировка<br>`timesheet.manual_correction`<br>[код](../../apps/backend/src/modules/approvals/utils/approval-capabilities.util.ts#L25) | не реализовано | свои, назначенные, выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |
| Заявка на исключение<br>`timesheet.exceptions.create`<br>[код](../../apps/backend/src/modules/timesheets/timesheets.service.ts#L1243) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E03](#e03) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| История исправлений<br>`timesheet.corrections.read`<br>[код](../../apps/backend/src/modules/timesheets/timesheets.service.ts#L1098) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Подотчёт

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Подотчёт<br>`accountability.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L44) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр счёта<br>`accountability.read`<br>[код](../../apps/backend/src/common/access/resource-access-context.ts#L138) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Сверка счетов<br>`accountability.review`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L146) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выдача подотчётных средств<br>`accountability.issue_cash`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L1698) | не проверено | свои, назначенные, выбранные, все | Руководящий круг | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Свободный приход на свой счёт<br>`accountability.external_receipt`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L534) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Сторно прихода<br>`accountability.correct_receipt`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L625) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Новый расход<br>`accountability.expenses.create`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L673) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение черновика расхода<br>`accountability.expenses.update`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L758) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отправка расхода<br>`accountability.expenses.submit`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L913) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E19](#e19) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Подтверждение расхода<br>`accountability.expenses.approve`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L1104) | проверено частично | свои, назначенные, выбранные, все | Новая выдача закрыта | [E18](#e18), [E19](#e19) | Legacy/deny, запрет новой выдачи, UI и независимость |
| Отклонение расхода<br>`accountability.expenses.reject`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L1104) | не проверено | свои, назначенные, выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Отправка сверки<br>`accountability.closure.request`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L1170) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Подтверждение сверки<br>`accountability.closure.approve`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L1332) | не проверено | свои, назначенные, выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Отклонение сверки<br>`accountability.closure.reject`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L1332) | не проверено | свои, назначенные, выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Сводка заказа<br>`accountability.order_summary.read`<br>[код](../../apps/backend/src/modules/accountability/accountability.service.ts#L204) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E19](#e19) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |

### Отсутствия и календарь пользователей

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Календарь пользователей<br>`user_absences.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L243) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр своего календаря<br>`user_absences.read`<br>[код](../../apps/backend/src/modules/dashboard/dashboard.controller.ts#L73) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Занятость коллег<br>`user_absences.view_all`<br>[код](../../apps/backend/src/modules/user-absences/user-absences.service.ts#L20) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание своего события<br>`user_absences.create`<br>[код](../../apps/backend/src/modules/user-absences/user-absences.service.ts#L106) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение своего события<br>`user_absences.update`<br>[код](../../apps/backend/src/modules/user-absences/user-absences.service.ts#L170) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление своего события<br>`user_absences.delete`<br>[код](../../apps/backend/src/modules/user-absences/user-absences.service.ts#L231) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Редактирование календарей коллег<br>`user_absences.manage`<br>[код](../../apps/backend/src/modules/user-absences/user-absences.service.ts#L21) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Приватные причины<br>`user_absences.view_private_reasons`<br>[код](../../apps/backend/src/modules/user-absences/user-absences.service.ts#L23) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### План посещений

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Дневные планы<br>`visit_plans.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L249) | проверено частично | свои, выбранные, все | Персональное правило | [E11](#e11) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр плана<br>`visit_plans.read`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L250) | проверено частично | свои, выбранные, все | Персональное правило | [E11](#e11) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Формирование планов<br>`visit_plans.manage`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L252) | проверено частично | свои, выбранные, все | Персональное правило | [E11](#e11) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Отметки посещений<br>`visit_plans.visits.manage`<br>[код](../../apps/backend/src/modules/visit-plans/visit-plans.service.ts#L102) | проверено частично | свои, выбранные, все | Персональное правило | [E11](#e11) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Отчёт посещения<br>`visit_plans.reports.manage`<br>[код](../../apps/backend/src/modules/visit-plans/visit-plans.service.ts#L103) | проверено частично | свои, выбранные, все | Персональное правило | [E11](#e11) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| История плана<br>`visit_plans.history`<br>[код](../../apps/backend/src/modules/visit-plans/visit-plans.service.ts#L471) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Замещения

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Объектные замещения<br>`user_substitutions.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L258) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр замещений<br>`user_substitutions.read`<br>[код](../../apps/backend/src/modules/user-substitutions/user-substitutions.service.ts#L33) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание своего замещения<br>`user_substitutions.create`<br>[код](../../apps/backend/src/modules/user-substitutions/user-substitutions.service.ts#L126) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Администрирование замещений<br>`user_substitutions.manage`<br>[код](../../apps/backend/src/modules/user-substitutions/user-substitutions.service.ts#L123) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отзыв замещения<br>`user_substitutions.revoke`<br>[код](../../apps/backend/src/modules/user-substitutions/user-substitutions.service.ts#L55) | не проверено | свои, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Кандидаты

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Кандидаты<br>`candidates.access`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L118) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр кандидатов<br>`candidates.view`<br>[код](../../apps/backend/src/common/access/resource-access-context.ts#L57) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Управление кандидатами<br>`candidates.manage`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L75) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Создание кандидата<br>`candidates.create`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L172) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Редактирование кандидата<br>`candidates.update`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L154) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Смена статуса<br>`candidates.status`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L156) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Архивирование<br>`candidates.archive`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L163) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Восстановление<br>`candidates.restore`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L164) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Ответственные менеджеры<br>`candidates.assignments.manage`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L157) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Ответ менеджера<br>`candidates.respond`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L159) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Оформить сотрудником<br>`candidates.convert_employee`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L165) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Прежний персональный запрет кандидатов<br>`candidates.denied`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L81) | проверено частично | все | Старый запрет | [E01](#e01) | Все каналы старого запрета, UI и обходы через назначения |

### Сотрудники

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Сотрудники<br>`employees.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L35) | проверено частично | выбранные, все | Персональное правило | [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр сотрудника<br>`employees.view`<br>[код](../../apps/backend/src/modules/approvals/utils/approval-read-access.util.ts#L145) | проверено частично | выбранные, все | Персональное правило | [E04](#e04), [E05](#e05), [E13](#e13), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Создание сотрудника<br>`employees.create`<br>[код](../../apps/backend/src/modules/candidates/candidates.service.ts#L165) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение сотрудника<br>`employees.edit`<br>[код](../../apps/backend/src/modules/employees/employee-schedule.service.ts#L49) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Архивирование<br>`employees.archive`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L1404) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Восстановление<br>`employees.restore`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L1411) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление ошибочной записи<br>`employees.delete_permanently`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L366) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Назначения на объекты<br>`employees.assignments.manage`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L1418) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Ошибочное назначение<br>`employees.assignments.delete_as_error`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L1428) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Недоступность сотрудника<br>`employees.availability.manage`<br>[код](../../apps/backend/src/modules/employees/employee-schedule.service.ts#L191) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Подмены сотрудника<br>`employees.substitutions.manage`<br>[код](../../apps/backend/src/modules/employees/employee-schedule.service.ts#L135) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выходы сотрудника<br>`employees.attendance.read`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L397) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отметки документов<br>`employees.documents.edit`<br>[код](../../apps/backend/src/modules/employees/employees.service.ts#L451) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Согласования

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Согласования<br>`approvals.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L18) | не проверено | выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Просмотр согласований<br>`approvals.read`<br>[код](../../apps/backend/src/common/access/resource-access-context.ts#L150) | проверено частично | выбранные, все | Персональное правило | [E13](#e13) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Результат задачи<br>`approvals.resolve_task_result`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L394) | не проверено | выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Изменение объекта<br>`approvals.resolve_object_change`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L406) | не проверено | выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Исключение склада<br>`approvals.resolve_inventory_exception`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L396) | проверено частично | выбранные, все | Новая выдача закрыта | [E18](#e18) | Legacy/deny, запрет новой выдачи, UI и независимость |
| Подотчёт<br>`approvals.resolve_accountability`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L398) | не проверено | выбранные, все | Новая выдача закрыта | — | Legacy/deny, запрет новой выдачи, UI и независимость |
| Прошлые денежные исправления<br>`approvals.resolve_timesheet`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L403) | проверено частично | выбранные, все | Новая выдача закрыта | [E02](#e02), [E03](#e03) | Legacy/deny, запрет новой выдачи, UI и независимость |
| Отмена своей заявки<br>`approvals.cancel`<br>[код](../../apps/backend/src/modules/approvals/approvals.service.ts#L355) | проверено частично | выбранные, все | Персональное правило | [E13](#e13) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |

### Чаты

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Чаты<br>`chat.access`<br>[код](../../apps/backend/src/modules/users-access/utils/auth-access-capabilities.util.ts#L73) | проверено частично | назначенные, выбранные, все | Персональное правило | [E16](#e16) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр чатов<br>`chat.read`<br>[код](../../apps/backend/src/common/access/notification-chat-visibility.ts#L35) | проверено частично | назначенные, выбранные, все | Персональное правило | [E16](#e16), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Поиск сообщений<br>`chat.search`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L219) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Личный чат<br>`chat.room.direct`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L406) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Групповой чат<br>`chat.room.group`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L506) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Изменение комнаты<br>`chat.room.update`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1939) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Участники чата<br>`chat.room.manage_members`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1981) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Скрытие чата<br>`chat.room.hide`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L662) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Показ скрытого чата<br>`chat.room.unhide`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L702) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выход из чата<br>`chat.room.leave`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L744) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Закрытие чата<br>`chat.room.close_global`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L793) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Чтение сообщений<br>`chat.messages.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L27) | проверено частично | назначенные, выбранные, все | Персональное правило | [E16](#e16), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Отправка сообщения<br>`chat.messages.create`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1924) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Редактирование своего сообщения<br>`chat.messages.edit`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1257) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Удаление сообщения<br>`chat.messages.delete`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1355) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Пересылка<br>`chat.messages.forward`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1435) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Реакция<br>`chat.messages.react`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1543) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Прочтение<br>`chat.read_receipts`<br>[код](../../apps/backend/src/modules/chats/chats.service.ts#L1600) | не проверено | назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Realtime комнаты<br>`chat.realtime`<br>[код](../../apps/backend/src/modules/chats/chat-realtime.service.ts#L273) | проверено частично | назначенные, выбранные, все | Персональное правило | [E16](#e16) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |

### Уведомления

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Уведомления<br>`notifications.access`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | проверено частично | свои, все | Персональное правило | [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Просмотр уведомлений<br>`notifications.read`<br>[код](../../apps/backend/src/common/access/notification-access.ts#L70) | проверено частично | свои, все | Персональное правило | [E13](#e13), [E15](#e15), [E17](#e17) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Отметка прочтения<br>`notifications.mark_read`<br>[код](../../apps/backend/src/modules/notifications/notifications.service.ts#L190) | проверено частично | свои, все | Персональное правило | [E13](#e13), [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Скрытие прочитанного<br>`notifications.dismiss`<br>[код](../../apps/backend/src/modules/notifications/notifications.service.ts#L214) | не проверено | свои, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Доставка уведомлений<br>`notifications.realtime`<br>[код](../../apps/backend/src/modules/chats/chat-realtime.service.ts#L238) | не проверено | свои, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |

### Поиск

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Поиск<br>`search.access`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Поиск<br>`search.query`<br>[код](../../apps/backend/src/modules/search/search.service.ts#L74) | проверено частично | все | Персональное правило | [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Недавние результаты<br>`search.recent`<br>[код](../../apps/backend/src/modules/search/search.service.ts#L467) | проверено частично | все | Персональное правило | [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |

### Файлы

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Файлы<br>`files.access`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не проверено | свои, назначенные, выбранные, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Чтение файла<br>`files.read`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L566) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Скачивание файла<br>`files.download`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L395) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E12](#e12), [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Превью<br>`files.preview`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L394) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Повтор подготовки превью<br>`files.preview.retry`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L396) | проверено частично | свои, назначенные, выбранные, все | Персональное правило | [E15](#e15) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Загрузка файла<br>`files.upload`<br>[код](../../apps/backend/src/modules/files/files.service.ts#L113) | не проверено | все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Отвязка файла<br>`files.detach`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не реализовано | свои, назначенные, выбранные, все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |

### Вход и сессия

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Учётная запись<br>`auth.access`<br>[код](../../apps/backend/src/modules/auth/strategies/jwt.strategy.ts#L53) | не проверено | свои, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Вход<br>`auth.login`<br>[код](../../apps/backend/src/modules/auth/auth.service.ts#L86) | не проверено | свои, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Свой профиль<br>`auth.me`<br>[код](../../apps/backend/src/modules/auth/auth.service.ts#L153) | не проверено | свои, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Обновление сессии<br>`auth.refresh`<br>[код](../../apps/backend/src/modules/auth/auth.service.ts#L116) | не проверено | свои, все | Персональное правило | — | Прямой API и UI: allow/deny/default, области, отзыв |
| Выход<br>`auth.logout`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не проверено | свои, все | Всегда доступен выход | — | Выход при любых ограничениях и завершение сессии |

### Настройки

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Настройки<br>`settings.access`<br>[каталог](../../apps/backend/src/modules/users-access/access-action-catalog.ts) | не реализовано | все | Нет отдельной операции | — | Отдельно принять действующие операции ниже |

### Пользователи и доступы

| Право и код | Статус | Области | Выдача / ограничение | Доказательства | Что проверить следующим |
| --- | --- | --- | --- | --- | --- |
| Пользователи и доступы<br>`users_access.access`<br>[код](../../apps/backend/src/modules/users-access/access-admin.service.ts#L515) | проверено частично | все | Только учредитель | [E01](#e01) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |
| Управление доступами<br>`users_access.manage`<br>[код](../../apps/backend/src/modules/users-access/access-admin.service.ts#L117) | проверено частично | все | Только учредитель | [E01](#e01), [E18](#e18) | Закрыть пробелы сценариев E; UI получателя, области и отзыв |

## Доказательства: фактический объём и ограничения

Все E01–E19 ссылаются на предыдущие прогоны, записанные в [общем реестре](access-control-enforcement-2026-11-07.md#recorded-local-evidence--2026-11-07). В текущем проходе исходники этих сценариев сопоставлены с действиями; новых успешных прогонов не заявляется. Сервисные проверки используют подставленные зависимости, если отдельно не указана HTTP/БД-проверка.

### E01

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-admin.integration.test.ts:21](../../apps/backend/test/access-control-admin.integration.test.ts#L21).
- Установлено: Доступ учредителя и запрет другим ролям; preview без записи, проверка параметров/версии/срока, единичное сохранение, история, защита последнего учредителя. Старый запрет кандидатов сохраняет приоритет.
- Граница: **Нет полного браузерного цикла выдачи/отзыва от имени получателя для каждого действия.**
- Строки: `users_access.access`, `users_access.manage`, `candidates.denied`.

### E02

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-admin-scoped.integration.test.ts:16](../../apps/backend/test/access-control-admin-scoped.integration.test.ts#L16).
- Установлено: Пересечение выбранного родительского запрета с дочерним разрешением в preview; запрещённая новая выдача полномочия согласующего отвергается без изменений.
- Граница: **Это проверка preview и границы полномочий, не успешного изменения материалов и не выдачи нового права согласующего.**
- Строки: `objects.access`, `objects.materials.manage`, `approvals.resolve_timesheet`.

### E03

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-timesheet-enforcement.integration.test.ts:13](../../apps/backend/test/access-control-timesheet-enforcement.integration.test.ts#L13).
- Установлено: Выбранный объект/все, контрольный объект, текущая cookie после отзыва, флаги строк, запрет родительского чтения, независимое согласование прошлых исправлений, закрытый период без эффектов.
- Граница: **Не проверен браузер получателя с открытой ячейкой/черновиком; не все роли и области каждого действия.**
- Строки: `timesheet.amount.edit`, `timesheet.exceptions.create`, `timesheet.read`, `approvals.resolve_timesheet`.

### E04

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-object-dto-enforcement.integration.test.ts:13](../../apps/backend/test/access-control-object-dto-enforcement.integration.test.ts#L13).
- Установлено: Запрет состава скрывает сотрудников, выборочный запрет Employee не скрывает контрольного; инструкции и контактная история скрыты, восстановление в той же сессии.
- Граница: **Не закрывает запись контактов/состава и все варианты личной выдачи.**
- Строки: `objects.staffing.read`, `employees.view`, `objects.materials.read`, `objects.contacts.read`.

### E05

- Тип: Сервисные тесты с подставленными зависимостями.
- Источник: [apps/backend/test/access-control-compensation-read.test.ts:47](../../apps/backend/test/access-control-compensation-read.test.ts#L47).
- Установлено: Раздельная финансовая редакция ставок/бюджета, фактические сотрудники и корректировки, отказ explanation до чтения начислений, родительский запрет.
- Граница: **Не все реальные HTTP/Excel/поисковые пути; нет браузерной приёмки этих прав.**
- Строки: `objects.read`, `objects.compensation.read`, `objects.rates.read`, `objects.budget.read`, `employees.view`.

### E06

- Тип: Сервисные проверки границы до записи.
- Источник: [apps/backend/test/access-control-compensation-leaf-writes.test.ts:1](../../apps/backend/test/access-control-compensation-leaf-writes.test.ts#L1).
- Установлено: Выбранный чужой читаемый объект достигает уникальной границы записи для версии/отмены/фонда; контрольный объект, отсутствие root read и общий deny блокируют. Старый бюджет не расширяет область.
- Граница: **Успешная транзакция БД не выполнялась: граница останавливается sentinel. Положительное общее manage-право этим не подтверждается.**
- Строки: `objects.rates.manage`, `objects.budget.edit`, `objects.compensation.manage`.

### E07

- Тип: Сервисные DTO/модульные тесты.
- Источник: [apps/backend/test/access-control-leaf-capabilities.test.ts:23](../../apps/backend/test/access-control-leaf-capabilities.test.ts#L23).
- Установлено: Разделение типов движения и агрегата canManage, самостоятельные delete/restore/update.
- Граница: **Для большинства перечисленных действий проверены вычисленные возможности, не реальная запись/отказ HTTP; отгрузка заказа дополнительно E14.**
- Строки: `inventory.receipt`, `inventory.issue_to_object`, `inventory.issue_to_one_time_order`, `inventory.return`, `inventory.writeoff`, `inventory.adjustment`, `inventory.catalog.update`, `inventory.catalog.delete`, `inventory.catalog.restore`.

### E08

- Тип: Сервисные DTO/модульные тесты.
- Источник: [apps/backend/test/access-control-leaf-capabilities.test.ts:49](../../apps/backend/test/access-control-leaf-capabilities.test.ts#L49).
- Установлено: Отдельные freeze/restore и ограничения жизненного цикла; контакты/материалы не выводятся из общего canEdit, root deny имеет приоритет.
- Граница: **Не выполнены все положительные и отрицательные мутации HTTP и проверка интерфейса получателя.**
- Строки: `objects.status`, `objects.freeze`, `objects.archive`, `objects.restore`, `objects.contacts.manage`, `objects.materials.manage`.

### E09

- Тип: Сервисные DTO/модульные тесты.
- Источник: [apps/backend/test/access-control-leaf-capabilities.test.ts:81](../../apps/backend/test/access-control-leaf-capabilities.test.ts#L81).
- Установлено: Возможности фактического сервиса getById разделены для update/link/archive/restore/master и архивного состояния.
- Граница: **Проверены возможности карточки, не все реальные операции связей, история и запреты на обеих сторонах.**
- Строки: `counterparties.update`, `counterparties.archive`, `counterparties.restore`, `counterparties.objects.link`, `counterparties.master_object.manage`.

### E10

- Тип: Сервисные тесты.
- Источник: [apps/backend/test/access-control-leaf-capabilities.test.ts:104](../../apps/backend/test/access-control-leaf-capabilities.test.ts#L104).
- Установлено: Независимость lost/broken в DTO; запрет изменения стоимости останавливает создание размера с ценой до транзакции; прямые финансовые изменения блокируются запретом чтения ставки/бюджета.
- Граница: **Lost/broken — только DTO; для финансовой корректировки проверен read-guard, не полный цикл собственного action allow/deny/default.**
- Строки: `equipment.lost`, `equipment.broken`, `mats.catalog.create`, `mats.cost.edit`, `objects.compensation.adjust`.

### E11

- Тип: HTTP + изолированная БД; дополнительно leaf-capabilities.
- Источник: [apps/backend/test/access-control-visit-discovery.integration.test.ts:16](../../apps/backend/test/access-control-visit-discovery.integration.test.ts#L16).
- Установлено: Свои/выбранный менеджер/контрольный менеджер, revoke/restore со старой cookie; read-only не создаёт план/запись/визит/отчёт; root deny и доступность менеджеров.
- Граница: **Мутационные права в интеграции проверены преимущественно на отказ под read-only; отдельная успешная персональная выдача каждого не подтверждена.**
- Строки: `visit_plans.access`, `visit_plans.read`, `visit_plans.manage`, `visit_plans.visits.manage`, `visit_plans.reports.manage`.

### E12

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-nested-dto.integration.test.ts:14](../../apps/backend/test/access-control-nested-dto.integration.test.ts#L14).
- Установлено: Запреты дочернего чтения дают 403/отсутствие вложений; отчёт остаётся читаемым при запрете записи; корневой доступ обязателен; вложенные файлы и HR-ветка не обходят родителей.
- Граница: **Часть действий покрыта только границей родителя или чтения; это не тест всех операций и всех типов файлов.**
- Строки: `one_time_orders.access`, `one_time_orders.read`, `one_time_orders.reports.read`, `one_time_orders.reports.update`, `one_time_orders.comments.read`, `one_time_orders.photos.read`, `one_time_orders.specification.read`, `files.read`, `files.download`, `objects.materials.read`, `objects.hr_reports_view`, `objects.reports.read`.

### E13

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-approvals-read.integration.test.ts:17](../../apps/backend/test/access-control-approvals-read.integration.test.ts#L17).
- Установлено: Чужие согласования selected/all без права решения; свои сохраняются, чужие отменять нельзя; фильтр до страницы/count/search; текущая cookie, source deny, сохранённые уведомления.
- Граница: **Для cancel — собственная базовая операция и запрет чужой, не матрица персонального разрешения; уведомления — проверка источника, не всех своих переключателей.**
- Строки: `approvals.read`, `approvals.cancel`, `objects.read`, `objects.access`, `objects.rates.read`, `employees.view`, `notifications.read`, `notifications.mark_read`.

### E14

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-order-inventory.integration.test.ts:66](../../apps/backend/test/access-control-order-inventory.integration.test.ts#L66).
- Установлено: Каталог и отгрузка в назначенный заказ у двух менеджеров; чужой заказ запрещён; allow/deny/default и текущая cookie, снятие назначения, закрытый заказ, повтор/конкуренция/остаток.
- Граница: **Чтение заказа здесь — зависимость, не все сценарии read. Нет воспроизведения конкретных серверных аккаунтов Дроздовского/Берендякова.**
- Строки: `inventory.issue_to_one_time_order`, `inventory.access`, `inventory.read`, `one_time_orders.access`, `one_time_orders.read`.

### E15

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-side-channels.integration.test.ts:13](../../apps/backend/test/access-control-side-channels.integration.test.ts#L13).
- Установлено: Родительский запрет/снятие назначения отражаются в поиске, recent, уведомлениях/count/read и файлах; собственные preview/retry/download запреты проверяются API.
- Граница: **Поиск/уведомления частично проверены по запретам источника; нет всех их собственных allow/deny/default. Не все форматы файлов/браузеры.**
- Строки: `objects.access`, `objects.read`, `search.query`, `search.recent`, `notifications.read`, `notifications.mark_read`, `files.read`, `files.preview`, `files.preview.retry`, `files.download`.

### E16

- Тип: Сервисный fan-out, без живого сокета/Redis.
- Источник: [apps/backend/test/access-control-realtime.test.ts:9](../../apps/backend/test/access-control-realtime.test.ts#L9).
- Установлено: Уже подключённый подставной клиент получает положительный контроль; актуальный запрет каждого действия прекращает выдачу событий; членство, закрытие и активность обязательны.
- Граница: **Нет сетевого WebSocket/Redis и браузерного теста; не проверены все операции чата.**
- Строки: `chat.access`, `chat.read`, `chat.messages.read`, `chat.realtime`, `objects.access`.

### E17

- Тип: Сервисные проверки видимости источников.
- Источник: [apps/backend/test/access-control-side-channels.test.ts:165](../../apps/backend/test/access-control-side-channels.test.ts#L165).
- Установлено: Свежий субъект/назначения, отрицательные права и область предков ограничивают сохранённые уведомления; Employee/HR и история членства чата сохраняют независимые основания доступа.
- Граница: **Проверены источники и предикаты, не каждый собственный endpoint действия и не вся доставка уведомлений.**
- Строки: `notifications.access`, `notifications.read`, `chat.read`, `chat.messages.read`, `employees.access`, `employees.view`, `objects.view_hr`, `objects.hr_reports_view`, `objects.reports.read`, `one_time_orders.specification.read`.

### E18

- Тип: Модульные тесты политики.
- Источник: [apps/backend/test/access-control-policy.test.ts:230](../../apps/backend/test/access-control-policy.test.ts#L230).
- Установлено: Новая allow не создаёт полномочия согласующего; founder/leadership/director ограничения действуют и в решении, и в фильтре списка.
- Граница: **Политика не равна реальной операции. Для выдачи полномочий, заблокированных каталогом, нужно отдельное утверждённое решение.**
- Строки: `accountability.expenses.approve`, `approvals.resolve_inventory_exception`, `one_time_orders.specification.manage`, `users_access.manage`, `objects.contract_amount.read`, `inventory.resolve_missing_photo`.

### E19

- Тип: HTTP + изолированная БД.
- Источник: [apps/backend/test/access-control-finance.integration.test.ts:96](../../apps/backend/test/access-control-finance.integration.test.ts#L96).
- Установлено: Сводка по собственному подотчёту не показывает чужой; чужой расход не отправляется; подтверждение отдельно от черновика, независимость и ровно один денежный эффект при гонке.
- Граница: **Это базовые денежные границы, не полный тест личных правил этих действий; конкретная производственная выплата не установлена.**
- Строки: `accountability.order_summary.read`, `accountability.expenses.submit`, `accountability.expenses.approve`.

## Восемь неподдерживаемых самостоятельных переключателей

Здесь «не реализовано» относится к отдельному правилу, а не ко всей функции. Наличие старой записи не даёт права переименовывать её или удалять историю.

| Код | Почему / что использовать |
| --- | --- |
| `objects.planning.manage` | Настройки планирования. Самостоятельного права планирования нет: бюджет проверяется действием «Изменение бюджета», сезоны — действием «Управление ставками». Этот переключатель не применяется.  Ориентиры: `objects.budget.edit`, `objects.rates.manage`. |
| `one_time_order_calendar.manage` | Управление календарём. Самостоятельного управления календарём нет: используйте действие «Доступность менеджеров». Прежнее разрешение управления календарём сохраняется источником действующего доступа, а не новым персональным правилом.  Ориентиры: `one_time_order_calendar.availability.manage`. |
| `equipment.move` | Перемещение. Перемещение выполняется действиями выдачи и возврата оборудования с проверкой исходного и целевого места. Самостоятельной операции перемещения нет.  Ориентиры: `equipment.assign_object`, `equipment.assign_order`, `equipment.return`. |
| `tasks.status` | Изменение статуса. Прежний общий запрос статуса не изменяет задачу. Используйте отдельные действия отправки результата, подтверждения, возврата, повторного открытия и отмены задачи.  Ориентиры: `tasks.result.submit`, `tasks.confirm`, `tasks.return`, `tasks.reopen`, `tasks.cancel`. |
| `timesheet.attendance.edit` | Посещаемость. Отдельного изменения посещаемости через табель нет: действуют «Отметки посещаемости» объекта и «Посещаемость заказа». Этот переключатель не применяется.  Ориентиры: `objects.attendance.edit`, `one_time_orders.attendance.edit`. |
| `timesheet.manual_correction` | Ручная корректировка. Устаревшее отдельное разрешение: изменение проверяется каноническим действием «Корректировка суммы в табеле» (timesheet.amount.edit). Сохранённые коды и история не меняются; запрет timesheet.manual_correction продолжает ограничивать корректировки. Исторические ограничения и независимое согласование сохраняются.  Ориентиры: `timesheet.amount.edit`. |
| `files.detach` | Отвязка файла Общего действия отвязки нет; специальная отвязка ТЗ не является универсальной заменой. Ориентиры: `one_time_orders.specification.detach`. |
| `settings.access` | Доступ к разделу «Настройки» Нет самостоятельной операции настроек. Управление пользователями и доступами — отдельная функция, не эквивалент всех настроек. Ориентиры: `users_access.access`. |

## Старые разрешения и ограничения из кода

Статический проход сопоставил **54 уникальных alias каталога** и **51 объявленный legacy-код из seed/INSERT-миграций**. Неизвестных сопоставлений в этой узкой выборке: **0**. Это проверка сопоставления, не приёмка 54 операций и не аудит фактической БД. Коды ниже могут совпадать с каноническими; один alias может питать несколько действий.

| Прежний код | Действующие действия каталога |
| --- | --- |
| `accountability.closure.approve` | `accountability.closure.approve` |
| `accountability.correct_receipt` | `accountability.correct_receipt` |
| `accountability.issue_cash` | `accountability.issue_cash` |
| `accountability.review` | `accountability.review` |
| `approval.resolve_inventory_exception` | `approvals.resolve_inventory_exception` |
| `approval.resolve_object_change` | `approvals.resolve_object_change` |
| `approval.resolve_task_result` | `approvals.resolve_task_result` |
| `auth.login` | `auth.login` |
| `candidates.denied` | `candidates.denied` |
| `candidates.manage` | `candidates.manage` |
| `candidates.respond` | `candidates.respond` |
| `candidates.view` | `candidates.view` |
| `chat.room.close_global` | `chat.room.close_global` |
| `chat.room.manage_members` | `chat.room.manage_members` |
| `counterparties.link_objects` | `counterparties.objects.link` |
| `counterparties.manage` | `counterparties.update` |
| `counterparties.view` | `counterparties.read` |
| `employees.archive` | `employees.archive` |
| `employees.assignments.delete_error` | `employees.assignments.delete_as_error` |
| `employees.assignments.manage` | `employees.assignments.manage` |
| `employees.create` | `employees.create` |
| `employees.delete_permanently` | `employees.delete_permanently` |
| `employees.edit` | `employees.edit` |
| `employees.restore` | `employees.restore` |
| `employees.view` | `employees.view` |
| `equipment.unit.delete` | `equipment.unit.delete` |
| `expense.approve` | `accountability.expenses.approve` |
| `inventory.catalog.delete` | `inventory.catalog.delete` |
| `object.budget_edit` | `objects.budget.edit` |
| `object.coefficient_edit` | `objects.coefficient.edit` |
| `object.daily_rate_edit` | `objects.rates.manage` |
| `objects.create` | `objects.create` |
| `objects.hr_reports_view` | `objects.hr_reports_view` |
| `objects.read` | `objects.read` |
| `objects.substitution.manage` | `user_substitutions.manage` |
| `objects.update` | `objects.update` |
| `objects.view_hr` | `objects.view_hr` |
| `one_time_order.calendar.approve_availability` | `one_time_order_calendar.availability.approve` |
| `one_time_order.calendar.manage` | `one_time_order_calendar.manage`, `one_time_order_calendar.availability.manage` |
| `one_time_order.escorts.manage` | `one_time_orders.escorts.manage` |
| `one_time_order.manage_all` | `one_time_orders.read`, `one_time_orders.update`, `one_time_orders.status`, `one_time_orders.managers.manage`, `one_time_orders.finance.read` |
| `one_time_order.review.edit` | `one_time_orders.review.edit` |
| `one_time_order.review.view_all` | `one_time_orders.review.view_all` |
| `tasks.create` | `tasks.create` |
| `tasks.read` | `tasks.read` |
| `tasks.update` | `tasks.update` |
| `timesheet.amount.edit` | `timesheet.amount.edit` |
| `timesheet.attendance.edit` | `timesheet.attendance.edit` |
| `timesheet.manual_correction` | `timesheet.manual_correction` |
| `timesheet.read` | `timesheet.read` |
| `user_absences.manage` | `user_absences.manage` |
| `user_absences.view_all` | `user_absences.view_all` |
| `user_absences.view_private_reasons` | `user_absences.view_private_reasons` |
| `visit_plans.manage` | `visit_plans.manage` |

### Что нельзя смешивать с выдаваемым правом

[Реестр жёстких ветвей](access-control-inventory-2026-11-06.md#hardcoded-branch-ledger-and-classification-decisions) остаётся очередью адресной проверки, а [архитектурная матрица](../architecture/access-matrix.md) — источником бизнес-ограничений. Перечисленные ниже правила не получают фиктивный статус «подтверждено» из-за наличия каталога:

| Семейство | Как учитывать в приёмке |
| --- | --- |
| Базовая роль, прямое legacy-право, создатель, активное назначение, замещение | Источник решения для конкретной строки. Проверять без персональных правил и после возврата к default; просроченное/отозванное назначение не сохраняет доступ. |
| Учредитель / руководящий круг / директор и согласующий | Отдельная граница полномочий. Allow вне круга не должен работать. Чтобы разрешить выдачу такого полномочия, нужно отдельное решение, изменение контракта и адресная приёмка. |
| Владелец, автор, участник чата, назначенный менеджер | Контекст и инвариант операции, а не обещание «все разрешает всё». Проверять чужой ресурс и независимые основания доступа. |
| Архив, заморозка, закрытый заказ, закрытый месяц, активность пользователя | Жизненный цикл. Разрешение не должно оживлять запрещённую операцию. |
| Самосогласование, неизменность денежного факта/снимка, идемпотентность, остаток | Непереопределяемые бизнес-инварианты. Проверять до эффектов и при гонках; не добавлять «разрешить обход» без отдельного решения. |
| Меню, capability DTO, файлы, поиск, история, экспорт, уведомления, realtime | Не альтернативные источники права. Должны отражать то же решение и актуальную область, а не сохранять старый доступ. |

### Открытые вопросы полноты

1. Все 291 строки охвачены; это не доказывает, что в коде нигде не осталось незарегистрированного условия. Динамические сборки, фактическую БД и жёсткие ветви надо сверять адресно по существующему ledger, без новой карты всей кодовой базы.
2. Для 199 строк нет достаточного принятого адресного результата; существующие файлы-кандидаты не объявлены успешными автоматически.
3. Для 84 частичных строк нужно закрыть ровно перечисленные границы и К1–К7; не повторять общую unit-проверку вместо реальной операции.
4. Для 8 самостоятельных переключателей нужно либо принять работу через канонические действия, либо отдельно утвердить новую самостоятельную операцию. Обычный allow сейчас не должен обещать несуществующий результат.
5. Конкретный серверный случай выплаты/расхода двух менеджеров не установлен и не сертифицирован исправленным локальными денежными регрессиями.

## Очередь следующей приёмки

1. **Табель + окно учредителя:** реальный получатель (в том числе Горбачёва), выбранный и контрольный объект, сохранение/отзыв/возврат к default, открытая ячейка/черновик, прошлое исправление и независимое согласование. Пользовательское правило в общей локальной БД не менять без согласованного тестового сценария.
2. **Разовые менеджеры, склад и подотчёт:** назначенный/чужой/закрытый заказ; реальная отгрузка и права каталога; черновик/отправка/подтверждение расхода без двойного учёта. Производственный случай — только просмотр в разрешённых пределах, без записи на сервере.
3. **Объекты и финансовые листья:** переход от проверок DTO/pre-effect к реальным мутациям и отказам, включая rate/fund/contacts/materials, скрытие в истории и Excel.
4. **Остальные разделы:** брать строки со статусом «не проверено» по одному модулю, с одним владельцем общих компонентов; отдельно читать ограничения выдачи и специальные инварианты.
5. **Сквозные каналы и независимая перепроверка:** браузер получателя, отзыв в сессии, файлы разных типов, экспорт, уведомления и живой realtime. Тяжёлые прогоны последовательно. Обновлять статус только по приложенным результатам.

Следующее внедрение, выдача прав, тестовые записи, коммит и развёртывание не входят в создание этой матрицы.

