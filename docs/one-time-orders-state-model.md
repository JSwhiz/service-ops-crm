# Разовые заказы: состояния и конкурентность

## Заказ

Канонические статусы: `new`, `planned`, `in_progress`, `completed`, `cancelled`.

- Повторная установка текущего статуса идемпотентна и не создаёт новый audit event.
- `cancelled` по умолчанию исключается из календаря и Excel; `includeCancelled=true` включает доступные отменённые заказы.
- Возврат из `cancelled` и любое сохранение расписания с конфликтами требуют повторной серверной проверки.
- Конфликт без подтверждения возвращает `409` и fingerprint текущего набора конфликтов. Сохранение повторно проверяет расписание под lock и принимает только тот же fingerprint; изменившийся набор требует нового подтверждения.
- PATCH дат сохраняет пропущенные поля. `executionStartDate: null` очищает диапазон; `executionEndDate: null` при существующем начале делает диапазон однодневным.
- PATCH отзыва сохраняет пропущенное поле; DELETE review очищает текст и оценку.

### Циклы завершения

- `completed` устанавливается только через `POST /one-time-orders/:id/complete`; legacy status endpoint не закрывает и не переоткрывает заказ.
- Complete фиксирует `OneTimeOrderCompletion` для конкретного `workCycle` под row lock. Повтор с тем же `clientRequestId` и payload идемпотентен; изменённый payload получает `409`.
- Reopen помечает текущее завершение `superseded`, увеличивает `workCycle` ровно один раз и возвращает заказ в `in_progress`. История прошлых циклов сохраняется.
- Клиент передаёт текущий `workCycle` при complete, поэтому запоздавший запрос старого цикла не может закрыть новый цикл после reopen.
- Каждое завершение содержит одну или несколько фактических payment rows. Method/destination/recipient, нулевая сумма и cumulative deviation от `agreedSum` валидируются backend до записи.
- Фактическая сумма заказа считается по всем `active` payments всех циклов; reopen сохраняет прошлые payments и не сторнирует их автоматически.
- Положительный payment с destination `manager_accountability` атомарно создаёт linked credit funding; organization и zero payments funding не создают. Locked accountability account откатывает весь complete.
- `clientRequestId` обязателен и имеет формат UUID. Повторная отправка того же payload с тем же UUID возвращает существующее завершение; тот же UUID с другим payload отклоняется.
- UI сохраняет UUID после сетевой ошибки и блокирует параллельный double click. Изменение формы создаёт новый UUID.
- Неактивные назначения, удалённые и неактивные пользователи не попадают в выбор получателя payment.
- Новый receipt повторно активирует terminal `closed` account. Для `closing_requested` он атомарно отклоняет единственный requested closure, отменяет связанный pending approval и возвращает account в `active`; несогласованное состояние откатывает всё завершение.
- Остаток подотчёта: credits минус debits минус approved/reconciled expenses. Forecast дополнительно вычитает submitted expenses; draft/rejected не меняют официальный остаток.

### Коррекция payment

- Проведённый payment не редактируется. Коррекция под row lock переводит исходную запись в `reversed`, создаёт reversal row и новый active replacement row.
- Связанный receipt funding сторнируется debit-записью; replacement при необходимости создаёт новый credit. Payment, funding и audit меняются в одной транзакции.
- Повторная или параллельная коррекция одной записи допускает ровно одного победителя; остальные запросы получают конфликт.
- Получателем replacement может быть текущий активный менеджер или исторический получатель того же completion. Снятие менеджера не уничтожает историю и не блокирует корректировку его receipt.

### Legacy completion

- Исторические искусственно созданные завершения без финансовых потомков удаляются корректирующей миграцией.
- Завершения с финансовой историей сохраняются с `completionSource=legacy_unknown`; API не приписывает им фиктивного автора, дату или комментарий.
- UI показывает такую запись как неизвестную историческую фиксацию и сохраняет доступ к связанным финансовым строкам.

### Расходы по циклам

- Расход может быть привязан к заказу до первого completion либо к конкретному `oneTimeOrderCompletionId`.
- При нескольких циклах клиент требует явного выбора; backend проверяет принадлежность completion заказу и доступ пользователя.
- Текущий менеджер, исторический получатель receipt и reviewer могут использовать доступный им cycle. Эта связь не расширяет доступ к карточке заказа.

## Техническое задание

Операции create/reorder/complete/reopen/delete сериализуются lock по `oneTimeOrderId`. Complete/reopen используют conditional update: повторный вызов не меняет timestamp и не создаёт дублирующий audit. Требование attachment проверяется внутри той же транзакции.

## Доступность менеджера

Статусы: `pending`, `approved`, `rejected`, `cancelled`.

- Exact duplicate `pending` по user/type/date range запрещён уникальным partial index.
- Другие пересекающиеся pending-запросы разрешены и возвращаются массивом `pendingRequests`.
- Approved ranges одного пользователя не пересекаются: это защищено PostgreSQL exclusion constraint.
- Resolve availability и связанного `ApprovalRequest` выполняется атомарно.
- Conditional update разрешает только один параллельный approve/reject/cancel; проигравшие запросы получают `409`.
- Domain audit и approval audit записываются в той же транзакции, что и конечное состояние.

## Историчность назначений

Календарь использует текущее активное назначение `one_time_manager`. Полная историческая реконструкция требует отдельных `assignedAt`/`removedAt` и пересечения периода назначения с месяцем календаря; автоматический backfill без достоверного источника не выполняется.

## Требование PostgreSQL

Exclusion constraint для approved availability использует extension `btree_gist`. На новом production database роль миграций должна иметь право выполнить `CREATE EXTENSION btree_gist`, либо extension должен быть заранее установлен администратором БД.

## Наблюдаемость

Structured logs фиксируют export, отклонённые и подтверждённые schedule conflicts, redacted conflict projection, duplicate availability request и approval race. Телефоны, комментарии, содержимое файлов, JWT и cookies не логируются.
