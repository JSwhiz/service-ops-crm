# Разовые заказы: модель доступа

Backend capabilities и `buildOneTimeOrderAccessWhere` являются источником истины. Скрытие действий на frontend не заменяет проверку API.

## Видимость заказа

| Субъект | Реестр и карточка | Calendar / Excel | Изменение |
|---|---|---|---|
| `founder`, `deputy_founder`, `director`, `corporate_director` | Все заказы | Полные данные | Полное управление |
| Пользователь с `one_time_order.manage_all` | Все заказы | Полные данные | Полное управление |
| Создатель заказа | Только созданные им | Полные данные своих заказов | Операционные и финансовые поля своих заказов |
| Активный `one_time_manager` | Только назначенные заказы | Полные данные назначенных заказов, остальные занятости redacted | Операционные поля назначенных заказов |
| `deputy_director` без отдельного permission/назначения | Нет глобального доступа | Только доступный scope | Нет глобального управления |
| `hr` | Только созданные им заказы | Календарь и availability по permission | Не получает управление заказами автоматически |
| Неактивный пользователь | Нет доступа | Нет доступа | Нет доступа |

Активное назначение означает `assignmentRoleCode = one_time_manager` и `isActive = true`. Создание задачи, просмотр файлов, фото, ТЗ, комментариев, истории и дочерних проекций сначала требуют доступ к родительскому заказу. Видимость самой задачи дополнительно определяется task access model.

## Возможности

- `one_time_order.manage_all`: полное управление заказами и менеджерами.
- `one_time_order.review.edit`: изменение и очистка отзыва.
- `one_time_order.calendar.manage`: прямое управление availability и просмотр pending-запросов.
- `one_time_order.calendar.approve_availability`: approve/reject availability.
- Финансовые поля доступны full-management или создателю заказа; активный менеджер получает только operational edit.
- Управлять менеджерами может создатель либо full-management actor.
- Собственный availability доступен eligible manager role или пользователю с активным назначением `one_time_manager`.

## Redaction

Calendar, conflict check и Excel используют общий order access scope. Занятость недоступным заказом сохраняется для предотвращения двойного назначения, но публично возвращается как `detailsRestricted = true`, `relatedOrder = null` или как «Занят». ID, название, адрес, контакт, объект и иные сведения скрытого заказа не раскрываются.

Публичные файловые ответы содержат только safe preview metadata и backend proxy URLs. `bucket`, `objectKey`, внутренние attachment relations и произвольные entity metadata не выдаются.
