# Разовые заказы: состояния и конкурентность

## Заказ

Канонические статусы: `new`, `planned`, `in_progress`, `completed`, `cancelled`.

- Повторная установка текущего статуса идемпотентна и не создаёт новый audit event.
- `cancelled` по умолчанию исключается из календаря и Excel; `includeCancelled=true` включает доступные отменённые заказы.
- Возврат из `cancelled` и любое сохранение расписания с конфликтами требуют повторной серверной проверки.
- Конфликт без подтверждения возвращает `409` и fingerprint текущего набора конфликтов. Сохранение повторно проверяет расписание под lock и принимает только тот же fingerprint; изменившийся набор требует нового подтверждения.
- PATCH дат сохраняет пропущенные поля. `executionStartDate: null` очищает диапазон; `executionEndDate: null` при существующем начале делает диапазон однодневным.
- PATCH отзыва сохраняет пропущенное поле; DELETE review очищает текст и оценку.

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

## Наблюдаемость

Structured logs фиксируют export, отклонённые и подтверждённые schedule conflicts, redacted conflict projection, duplicate availability request и approval race. Телефоны, комментарии, содержимое файлов, JWT и cookies не логируются.
