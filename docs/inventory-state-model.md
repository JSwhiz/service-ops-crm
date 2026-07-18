# Inventory State Model

## Позиция каталога

- Позиция создаётся активной и получает `version = 1`.
- Любое изменение увеличивает `version`; PATCH требует `expectedVersion`.
- Несовпадение версии возвращает `409 INVENTORY_ITEM_VERSION_CONFLICT` и не
  перезаписывает актуальные данные.
- Физическое удаление позиции не используется. Состояния: active и archived.
- Архивирование запрещено при ненулевом остатке, pending movement или pending
  approval. Реактивация возвращает позицию в operational flow.
- Новые движения по archived позиции запрещены.

## Duplicate invariant

Среди активных позиций уникальна нормализованная комбинация
`lower(trim(name/category/unit))`. Архивный duplicate допустим, но реактивация
при существующем active duplicate отклоняется с
`409 INVENTORY_ITEM_DUPLICATE`.

## Цена и остаток

- `currentUnitPrice` нельзя менять через create/update catalog DTO.
- Цена равна максимальному `unitPriceSnapshot` среди применённых `receipt`.
- Более дешёвый последующий приход не снижает цену; issue, return, writeoff и
  adjustment цену не меняют.
- Backfill повторно вычисляет цену из applied receipts и является идемпотентным.
- Остаток считается только по движениям со status `applied`.

## Движения

Типы: `receipt`, `issue_to_object`, `issue_to_one_time_order`, `return`,
`writeoff`, `adjustment`.

- Receipt, issue, return и adjustment применяются сразу.
- Writeoff создаётся как `pending_approval`, затем переходит в `applied`,
  `rejected` или `cancelled` через shared approvals.
- При approve writeoff остаток пересчитывается под row lock. Отрицательный
  остаток запрещён, даже если запас изменился после создания request.
- Issue без обязательного evidence может быть applied с pending
  `inventory_exception_confirmation`. Загрузка активного файла отменяет bridge;
  альтернативно resolver фиксирует исключение.
- Удалённые файлы не учитываются как evidence и не возвращаются в responses.

## Concurrency и audit

- Catalog update использует row lock и conditional update по `id/version`.
- Receipt сериализуется lock по inventory item, поэтому параллельные поставки не
  теряют максимальную цену.
- Approval resolve блокирует request и movement; изменение status выполняется
  conditional update. Ровно один параллельный resolver успешен, остальные
  получают `409`.
- Movement/item, price/status, ApprovalRequest, domain audit и approval audit
  записываются одной транзакцией. Ошибка audit откатывает business change.

## Read model

- Каталог и общая история используют server-side pagination.
- Каталог поддерживает search, category, active state и sorting.
- История поддерживает movement type, status, date range, object и one-time order.
- `items` и `total` строятся из одного access/filter where.
