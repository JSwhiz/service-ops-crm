# Разовые заказы: финансовая модель

Backend является источником истины для сумм, доступа, статусов и связей.
Frontend и Excel не пересчитывают финансовую историю самостоятельно.

## Циклы завершения

`OneTimeOrderCompletion` фиксирует один `workCycle`. Завершение создаётся только
через completion endpoint под lock заказа. Reopen сохраняет прошлый cycle,
помечает его `superseded` и увеличивает номер цикла. Обход через обычную смену
статуса запрещён.

`clientRequestId` обязателен и уникален в пределах заказа. Backend хранит hash
payload: сетевой retry с тем же UUID и payload идемпотентен, а изменённый payload
с тем же UUID отклоняется. Frontend повторно использует UUID только для той же
формы и блокирует double click.

## Payments и коррекции

Каждое native completion содержит минимум один payment. Payment хранит сумму,
назначение, способ, получателя, автора фиксации и cumulative reason при
отклонении от договорной суммы.

- `active` участвует в фактической сумме;
- `reversed` сохраняется как исходная историческая запись;
- reversal payment компенсирует исходную запись;
- replacement payment является новым активным фактом и ссылается на источник
  коррекции.

Проведённые финансовые поля immutable на уровне PostgreSQL. Коррекция создаёт
цепочку source/reversal/replacement и не обновляет сумму исходной записи. Row
lock и conditional update разрешают только одну параллельную коррекцию.

## Funding и остатки

Положительный payment в `manager_accountability` создаёт credit funding типа
`one_time_order_receipt`. Organization и zero payment funding не создают.
Коррекция receipt создаёт debit reversal и, если требуется, новый credit.

Текущий остаток считается как credits минус debits минус `approved` и
`reconciled` expenses. Forecast дополнительно вычитает `submitted`; `draft` и
`rejected` не влияют на официальный остаток.

Если новый receipt приходит в `closed` account, тот же живой контур возвращается
в `active`. Для `closing_requested` единственный requested closure отклоняется,
его pending approval отменяется и account активируется. Любая несогласованность
closure/approval откатывает completion и funding целиком.

## Расходы

Expense проходит `draft`, `submitted`, `approved`/`rejected`, `reconciled`.
После submit его сумма, описание и финансовые связи immutable. Transition,
business effect и audit выполняются в одной транзакции и защищены conditional
update от параллельного resolve.

Expense может ссылаться на заказ без completion до первого завершения либо на
конкретный completion cycle. Completion обязан принадлежать заказу. При
нескольких циклах пользователь выбирает cycle явно. Исторический получатель
receipt сохраняет доступ к собственному expense contour после снятия назначения.

## Видимость и redaction

Полные payment details видят пользователи с `accountability.review` или
`accountability.correct_receipt`. Остальные видят только собственный receipt и
organization payment, который сами зафиксировали. Чужая строка сохраняет только
стабильный id и `detailsRestricted=true`; сумма, получатель, способ, комментарии
и audit metadata не раскрываются. Visible totals строятся только по доступным
active rows и явно помечаются как неполные.

Общий доступ к заказу не даёт доступ к чужому подотчёту. Исторический receipt
даёт доступ только к собственному accountability projection и не открывает
карточку заказа. Файлы возвращаются через `SafeFileResponseDto` и backend proxy;
bucket/object key не публикуются.

## Legacy history

Искусственные legacy completion без финансовых потомков удалены корректирующей
миграцией. Строки с финансовой историей сохраняются как `legacy_unknown`; автор,
дата и комментарий не выдумываются и отображаются как неизвестные.

## Удаление и атомарность

Связи completion, payment, funding, account, expense и order используют
`ON DELETE RESTRICT` для финансовой истории. Триггеры запрещают изменение
проведённых финансовых полей. Business write и audit выполняются одной Prisma
transaction; ошибка audit откатывает изменение.

Эта модель не содержит зарплатных расчётов, уведомлений или новых глобальных
финансовых ролей. Она ограничена поступлениями по разовым заказам, подотчётом,
расходами, сверкой и корректирующей историей.
