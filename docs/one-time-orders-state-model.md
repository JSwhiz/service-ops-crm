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
