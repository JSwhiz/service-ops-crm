# Inventory Access Matrix

Этот документ фиксирует текущий effective access контура расходников. Backend
helpers и capabilities остаются источником истины; frontend только отображает
возвращённые права.

## Глобальный доступ

| Возможность | founder | deputy_founder | director | corporate_director | deputy_director | прочие роли |
| --- | --- | --- | --- | --- | --- | --- |
| Открыть каталог и карточку | да | да | да | да | да | нет |
| Управлять каталогом | да | да | да | да | да | нет |
| Создавать приход | да | да | да | да | да | нет |
| Выдавать на объект/разовый заказ | да | да | да | да | да | нет |
| Возврат, списание, корректировка | да | да | да | да | да | нет |
| Смотреть общие движения и отчёты | да | да | да | да | да | нет |
| Legacy resolve отсутствующего фото | нет | нет | да | нет | нет | нет |

`deputy_director` имеет операционный inventory-доступ, но не получает
финансовые, HR или timesheet-права через этот модуль.

## Shared approvals

- `inventory_exception_confirmation` разрешает `director` либо permission
  `approval.resolve_inventory_exception`.
- `inventory_writeoff_confirmation` разрешает leadership circle либо permission
  `approval.resolve_inventory_exception`.
- Создатель pending writeoff может отменить свой approval request через общий
  approval-контур.
- Решение approval и business effect движения применяются одной транзакцией.

## Scoped access

- Object-assigned пользователь работает с выдачей через object inventory API;
  это не даёт ему доступ к глобальному каталогу или реестру движений.
- Файл движения читается глобальным inventory-пользователем, автором движения
  либо пользователем, имеющим доступ к связанному объекту/разовому заказу.
- Запись файла разрешена глобальному inventory operator либо автору движения.
- История позиции использует глобальную inventory-проверку и не обходит её через
  query parameters.

## Public response

Вложения движения используют `SafeFileResponseDto`: `id`, `originalName`,
`mimeType`, `sizeBytes`, `createdAt`, `viewUrl`, `downloadUrl`. Поля `bucket`,
`objectKey`, attachment relations и storage metadata публично не возвращаются.
