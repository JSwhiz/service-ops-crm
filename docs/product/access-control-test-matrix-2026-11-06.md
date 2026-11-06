# Управление доступами — независимая матрица проверок E

Дата основания: 2026-11-06; evidence обновлено 2026-11-07. Статус: main подтвердил unit 42/42 PASS, DB aggregate 25/25 в четырёх изолированных schemas, отдельно SQL truth 19/19 и finance 2/2. Подробности и пределы — в разделе «Фактические результаты». Полный охват всех прав, UI/live и production не подтверждены. Сценарные строки сами по себе не означают passed или исправление конкретного пользовательского случая.

## Основания и границы

Прочитаны `AGENTS.md` и шесть основных контрактов: `product-contract.md`, `../architecture/access-matrix.md`, `../architecture/glossary.md`, `open-questions-register.md`, `reconciliation-notes.md`, `golden-path-index.md`. Дополнительное основание — [согласованный rollout](access-control-rollout-2026-11-06.md), особенно разделы 3–5, 7–8 и GP-ACL-001…005.

E владеет этим документом и новыми `apps/backend/test/access-control*.test.ts`; новые UI unit-тесты остаются отдельным этапом в согласованных с C каталогах. Общие helpers, production source, DTO, schema, migrations и seed принадлежат другим владельцам. E не выполняет commit и тяжёлые suites. Основной агент запускает интеграции/сборки последовательно и сообщает фактические результаты. Production допускает только чтение: изменения, deploy, выдача прав и записи данных там не разрешены; production-проверки E не проводил.

Существующие тесты ниже — ориентиры сценариев, а не подтверждение их прохождения в текущем дереве. Нулевые overrides должны сохранять прежний эффективный доступ; выявленный конфликт runtime с контрактом фиксируется отдельно и не становится молчаливым изменением baseline. Два согласованных менеджерских изменения учитываются отдельно от остальных пользователей. Неизвестные бизнес-правила не выводятся из названия permission или успешного общего теста.

## Короткий handoff для B: наиболее вероятные регрессии

1. Сохранить смысл legacy-deny. `candidates/utils/candidate-access.util.ts` сначала проверяет `candidates.denied`; `candidate-reminder.service.ts` отдельно фильтрует direct permissions. Простое объединение положительных кодов или перенос только UI-кнопок может открыть кандидатский контур и напоминания запрещённым пользователям. Проверить deny при роли, direct allow и делегировании, а также default после снятия нового override.
2. Ролевые pure helpers не умеют представлять персональный scoped deny. `inventory/utils/inventory-access.util.ts` принимает роли для большинства операций; controller reports также вызывает ролевую функцию. `one-time-order-access.util.ts` имеет ранний широкий allow, `one-time-order-capabilities.util.ts` сочетает роли/permissions, chat helper принимает роли. Нужны согласованные точки подключения policy до широкого allow и в фильтрах выборки, а не только новый `permissionCodes` в `/auth/me`.
3. Отдельно сверить доставку после отзыва: поиск/recent, preview/download, экспорт, сохранённые уведомления, отложенные очереди и уже подключённая realtime-комната. Проверка на входе в room не заменяет проверку последующей доставки. Вложенные audit payload и ссылки из заказа/контрагента тоже могут раскрыть запрещённый объект.
4. Текущий `canAccessInventory` уже разрешает read-only роли `manager`, `senior_manager`, `operation_manager`. Это согласуется с замечанием rollout о недоказанной причине закрытого каталога, но отличается от старой таблицы module access. Не считать выдачу общего catalog-view доказанным исправлением и не расширять автоматически movement/catalog-management.
5. Scope, permission и независимое согласование — разные условия. Assignment не разрешает глобальный склад, отзыв блокирует старую форму; выдача права не разрешает self-approval или изменение проведённого ledger. Последнего действующего founder следует защищать транзакционно, включая две конкурентные правки.

Это риски по чтению исходников, не доказанные эксплойты. B не найден среди доступных чатов; прямое сообщение ему пока не доставлено, handoff доступен здесь для основного агента.

## Изоляция и существующие опоры

| Опора | Что действительно делает | Применение E / ограничение |
| --- | --- | --- |
| `apps/backend/scripts/run-integration-tests.mjs` | Для каждого выбранного файла создаёт schema `integration_<pid>_<index>`, задаёт `DATABASE_URL`, отдельное имя preview queue и `TEST_ISOLATED_DATABASE=true`; запускает migrations, seed и Node test; удаляет schema в finally | Только основной агент запускает в подтверждённом изолированном окружении. Runner по умолчанию обнаруживает только `*.integration.test.ts`; новым DB-тестам E нужно такое окончание либо явный выбор файла |
| `test/helpers/isolated-database.ts` | Читает env-флаг; сам БД не изолирует | Нельзя считать вызов helper защитой от записи в dev/main schema; DB-тест E должен отказаться работать без подтверждённого isolated runner |
| `test/helpers/create-test-app.ts` | Поднимает полный AppModule и HTTP listener на свободном localhost-порту | Это интеграционный старт, не лёгкий unit-тест; сейчас не запускать |
| `test/helpers/auth.ts` | Реальный login возвращает cookie | Для проверки одной и той же сессии до grant/revoke; не имитировать отзыв повторным login |
| `test/helpers/core-fixtures.ts` | Создаёт новый объект, но использует seeded founder/manager/Employees; бизнес-дата зависит от текущего месяца | Для финансовых/срочных границ задавать явные даты в тесте; не путать User и Employee; общие fixture/seed не менять |
| `test/helpers/approve-financial-change.ts` | Подтверждает pending response другим cookie, но при отсутствии approval id просто возвращается | В adversarial-тесте самостоятельно assert pending/id, неизменность денег до решения и отличного actor; helper не заменяет отрицательный тест |
| `role-permissions.integration.test.ts`, `auth-me.integration.test.ts` | Примеры роли + direct permission и auth payload | Снять независимые ожидаемые значения, сравнить после role/grant/revoke в прежней сессии |
| `calendar-chat-policy.test.ts`, `object-rate-access.test.ts` | Node unit-тесты pure policy/service с подставленным data layer | Подход для быстрых deny/scope случаев без AppModule/БД; не подменяет HTTP/доставку |
| Frontend `*.test.mjs`, например `commit-and-refresh.test.mjs` | `node:test` + assert, проверка состояния и порядка async операций | Новые unit-тесты поведения draft/preview/save/refresh; визуальная/клавиатурная приёмка отдельно у основного агента/C |

## Baseline по ролям и источникам (GP-ACL-005)

Для каждой строки снять старое решение и payload на одинаковых fixture, затем проверить новый resolver без overrides. Сравнивать allow/deny, ids строк, capabilities, redaction и отсутствие побочных записей. Оракул — зафиксированный старый результат и контракт, не вызов нового resolver с обеих сторон. Покрыть одиночные роли, несколько ролей и роль, отличную от первого `roleCode`.

| Набор акторов | Положительная и отрицательная baseline-пара | Существующие ориентиры |
| --- | --- | --- |
| `founder` | Управление доступами; object core; отдельные финансовые полномочия; нельзя самому подтвердить обязательный независимый approval | `object-access`, `team-compensation-acceptance`, `bootstrap-first-admin` |
| `deputy_founder`, `director`, `corporate_director` — каждый отдельно | Leadership object core, но разные budget/manual correction/cash issuance defaults; только founder управляет новым окном | `object-access`, `timesheet-permissions`, `accountability-access`, `approvals-wave2` |
| `deputy_director` | Operational/rate-management, HR view-only; без автоматического budget/core/historical correction/leadership approval | `object-rate-access.test.ts`, `employee-access-matrix`, `task-access`, `calendar-chat-policy.test.ts` |
| `manager`, `senior_manager`, `operation_manager` — каждый отдельно | Свой/назначенный контур; чужой объект/заказ и global mutations не открываются; `operation_manager` исключён из objects chat | `one-time-order-capabilities`, `object-access`, `chat-membership-access`, `inventory` |
| `hr`, `sys_admin` — каждый отдельно | HR и системные действия ровно по действующим правилам; название sys_admin не делает founder или финансовым approver | `employee-access-matrix`, `employees-hr`, `role-permissions` + реестр A для session/settings действий |
| `responsible`, object `manager`, `one_time_manager` | Это назначения; active/inactive, назначенный/неназначенный, автор заказа без назначения проверяются отдельно; Employee без User CRM-доступ не получает | `one-time-order-capabilities`, `object-access`, `one-time-order-specification` |
| Direct permission / legacy deny / персональные продуктовые исключения | Сохраняются candidates deny, calendar private/manage, HR report-only, chat members, escorts, visit plans, coefficient; переименование login/ФИО ничего не выдаёт | `role-permissions`, `candidates-multi-manager`, `user-absences`, `employee-hr-object-access`, `plans-orders-operations` |
| Объектное замещение | Union собственных и делегированных прав только в выбранных объектах/сроке, сохранение двух actors; global sensitive права не наследуются | `user-substitutions` |
| Inactive / unauthenticated | Доступ не возникает из role/direct grant/старой сессии; endpoint использует свой документированный auth response | `auth-me`, `calendar-chat-policy.test.ts` + auth API |

В таблицах короткое имя существующего backend-теста без расширения означает `apps/backend/test/<имя>.integration.test.ts`, если полное имя `.test.ts` не указано явно.

## Матрица ядра, scopes и административных инвариантов

AC-строки описывают критерии; фактическое частичное покрытие и результаты перечислены отдельно ниже. Там, где результат не указан, статус остаётся **planned / not run**. Предлагаемые в строках имена файлов — план группировки; реальные опубликованные тестовые файлы перечислены в разделе результатов.

| ID / golden path | Setup и действие | Ожидаемый результат / доказательство | Новый файл E |
| --- | --- | --- | --- |
| AC-01 / ACL-001,005 | Каждый зарегистрированный код/действие A; baseline всех акторов выше | Старое решение сопоставлено policy, UI/API, каналам и конкретным test case. Неизвестный/дублирующий/отсутствующий action классифицирован; отсутствующая функция не становится работающей галочкой | `access-control-baseline.test.ts` + integration при необходимости |
| AC-02 / ACL-002 | Default → allow → deny → default с role grant/direct grant | Источник и effective result объяснимы; deny перекрывает унаследованный allow в соответствующем scope; reset возвращает baseline, не удаляет роль | `access-control-policy.test.ts` |
| AC-03 / ACL-003 | `own`: actor A/B; подмена owner/user/creator id в запросе | Только собственные записи в поддерживаемом действием значении own; сервер определяет принадлежность, не доверяет request id | `access-control-scope.test.ts` |
| AC-04 / ACL-003,004 | `assigned`: active, inactive, снятое, будущее/истёкшее назначение; старый открытый запрос | Только текущее назначение нужной сущности; assigned не равно createdBy и не открывает соседний объект | `access-control-scope.test.ts` |
| AC-05 / ACL-003 | `selected`: X включён, Y исключён; смешанный список X/Y, поддельный id | Доступ только к выбранным сущностям; списки/агрегаты/мутации фильтруются одинаково; пустой набор не означает all | `access-control-scope.test.ts` |
| AC-06 / ACL-003 | `all`: доступ ко всему поддерживаемому набору; иной tenant/domain/закрытый lifecycle, если применимо | all не отменяет независимое согласование, closed/frozen ограничения, приватность отдельного поля или чужой domain | `access-control-scope.test.ts` |
| AC-07 / ACL-002 | Неподдерживаемая область, неизвестный код, некорректный target | Preview/save отклоняет или явно сообщает неэффективность по контракту B; не сохраняет расширение молча | `access-control-admin.integration.test.ts` |
| AC-08 / ACL-003 | Parent objects deny + child allow, role, assignment и delegation | Child не открывает раздел; preview объясняет неэффективность; URL/API и все каналы ниже закрыты; независимый календарь сохраняет свой разрешённый scope | `access-control-parent-deny.integration.test.ts` |
| AC-09 / ACL-003,005 | Замещение на X, собственный доступ Y; expiry/revoke, explicit deny X | Собственные права не сужены union; deny перекрывает делегацию в scope; нет inherited finance/HR approval; оба actor в аудите | `access-control-scope.test.ts` и integration |
| AC-10 / ACL-002 | Founder и каждый non-founder напрямую вызывает registry/detail/preview/save/history | Только founder имеет управление; read history не открывает редактирование аудита; причина обязательна; rejected request не меняет grants | `access-control-admin.integration.test.ts` |
| AC-11 / ACL-002,005 | Preview на v1, затем новая правка scope/роли; save со старой версией; два одновременных save | Один согласованный победитель; stale writer получает контрактный conflict, не перетирает; сервер повторно проверяет impact/authorization при записи | `access-control-admin.integration.test.ts` |
| AC-12 / ACL-005 | Последний активный founder запрещает себе управление/деактивирует или снимает роль; два founder одновременно снимают друг друга | Всегда остаётся минимум один действующий администратор; rejected action атомарен, не оставляет частичных grants/audit success | `access-control-admin.integration.test.ts` |
| AC-13 / ACL-003 | Одни cookie до allow/revoke, устаревшие capabilities и открытая форма | Следующий API/read/delivery использует текущее право; UI обновляет capabilities; stale JWT/menu не являются источником решения | `access-control-session.integration.test.ts` |
| AC-14 / ACL-005, PAY-006 | Автор имеет расширенный grant инициирования/approval, пытается подтвердить свою чувствительную финансовую правку | Self-approval запрещён; другой допустимый leadership User подтверждает; deputy_director и делегат не получают authority автоматически; деньги до approval неизменны | `access-control-finance.integration.test.ts` |
| AC-15 / ACL-002 | Успешные allow/deny/reset и неуспешный stale save | История сохраняет actor/time/reason, точные before/after, scope/version; нет ложной успешной истории отклонённой записи, аудит недоступен для редактирования | `access-control-admin.integration.test.ts` |

## Все каналы при запрете и отзыве (AC-08, AC-13)

Для каждого канала подготовить доступную X и запрещённую Y с уникальным маркером в названии/тексте/файле. Положительная проверка X обязательна: пустой ответ из сломанного endpoint не доказывает защиту. Повторить после отзыва в той же сессии; проверять payload и побочные эффекты, а не только HTTP status. Точные 403/404/error codes фиксируются по опубликованному API, без придумывания новых кодов.

| Канал | Отрицательная проверка | Доказательство и ориентир |
| --- | --- | --- |
| Direct URL / API / nested link | Открыть Y по известному id, из заказа/контрагента/задачи; mutation с чужим target; batch X/Y | Нет Y и скрытых полей; нет записи/изменения. `object-access`, `task-access`, `counterparties`, `one-time-order-capabilities` |
| List / detail / history / sensitive fields | Список, counts, nested audit payload, HR report-only | Нет запрещённых строк и финансовых полей рекурсивно; history не раскрывает прежнее значение. `employee-hr-object-access`, `audit-history-filters` |
| Search / suggestions / recent resolution | Найти уникальный маркер Y, разрешить сохранённый recent id после revoke | Нет title/snippet/id/чувствительной подсказки Y. `global-search`, `approvals-search`, candidates access |
| Files | Metadata, preview, download, upload/link/unlink через known file/attachment id и другой parent | Файл наследует parent + action; нет storage URL/binary leak, чужой связи или физического удаления при detach. `file-preview`, `file-upload`, `object-media`, `employee-documents` |
| Export / reports | Экспорт с фильтром Y и без фильтра, X/Y; ранее открытая export форма | Нет строк, имён, сумм и файлов Y. `timesheet-rate-policy-export`, `one-time-order-calendar-export`, `one-time-order-workforce-attendance` |
| Notifications | Сохранённое уведомление, queued delivery до revoke, list/count/link после revoke | Ни дальнейшего payload Y, ни запрещённого перехода; персональный dismiss/read не удаляет общий event. `candidate-notifications`, `notifications-personal`, `notification-outbox.test.ts` |
| Realtime | Join Y, уже joined room до revoke, последующее событие, reconnect | Нет новых событий Y после revoke; проверен реальный путь получателей/доставки, не только helper join. `chat-membership-access`, `chats`, `platform-connectivity` |

Новое размещение E: `access-control-side-channels.integration.test.ts`; DB/queue/socket проверки исполняет основной агент. До исполнения эти строки остаются planned, даже при успешных unit-тестах resolver.

## Два менеджера, два заказа и склад (GP-ACL-004)

Изолированные акторы M1/M2 моделируют Дроздовского/Берендякова; права назначаются по стабильному идентификатору/официальному API, не по ФИО. O1 назначен M1, O2 назначен M2; оба открыты, один складской item с известным остатком. Каждый менеджер проверяется отдельно. Дополнительно состояние «без назначения» и закрытый O1. Имена реальных пользователей не означают изменение рабочих grants.

| ID | Действие | Ожидаемая проверка | Ориентир / новое покрытие E |
| --- | --- | --- | --- |
| INV-01 | M1 отгружает в O1, M2 в O2 из карточки заказа | Разрешён выбор необходимых позиций/остатков и scoped issue; одно движение с правильным order/actor/quantity/snapshot/evidence | `inventory`, `inventory-supply-price`; `access-control-order-inventory.integration.test.ts` |
| INV-02 | M1 → O2 и M2 → O1; снять назначение и повторить из старой формы | Запрет без движения/списания/ложного audit success; новый grant не делает неназначенного manager assigned | Тот же новый файл; `one-time-order-capabilities` |
| INV-03 | Закрыть O1 до submit; frozen/archived target там, где предусмотрено | Mutation запрещена; открытие карточки/read-only не равно праву отгрузки | Тот же новый файл; `inventory-corrections` |
| INV-04 | Попытки global receipt/writeoff/adjustment/catalog mutation и чужого object target | Scoped shipment не выдаёт глобальный склад, редактирование номенклатуры, чужие объекты или полномочия approve | Тот же новый файл; `inventory-catalog-hardening` |
| INV-05 | Двойной клик/retry с тем же idempotency key; повтор после потерянного ответа | Одно движение и одно списание, стабильный результат; тот же ключ с изменённым payload не создаёт второй эффект по контракту API | Тот же новый файл; `inventory-movement-hardening` |
| INV-06 | Два разных запроса конкурируют за последний остаток | Нет отрицательного остатка, итог равен применённым движениям; проверки и применение атомарны | Тот же новый файл; inventory hardening |
| INV-07 | Нет обязательного evidence; неверный тип/чужой файл; попытка self-approval | Существующая typed evidence/approval семантика сохранена; director-only исключение для object issue не расширено на все order movements | Тот же новый файл; `inventory-movement-hardening`, `media-batch-retry` |
| INV-08 | Correction/reversal подтверждённого движения повторно/конкурентно | Один компенсирующий возврат исходного количества/стоимости; нет удаления истории или нового global grant | Тот же новый файл; `inventory-corrections` |

Фактическая причина недоступности каталога в живой менеджерской сессии остаётся **не воспроизведена**. INV-01 — приёмка нового workflow, не доказательство исходной UI-причины.

## Выплаты: общая регрессия и отдельный незакрытый случай

Новый файл E после API: `access-control-finance.integration.test.ts`. Ориентиры: `one-time-order-accountability-expenses`, `one-time-order-accountability-sync`, `one-time-order-completion-payments`, `one-time-order-payment-corrections`, `financial-history-persistence`, `accountability-concurrency`, `team-compensation-acceptance`.

| ID | Общая проверка на изолированных данных | Ожидаемый результат |
| --- | --- | --- |
| PAY-01 | Employee payout с явными User/account, Employee, order, operation date и work cycle; состояния draft/submitted/approved/reconciled/rejected | «Начислено», «На проверке» и «Подтверждённо выплачено» раздельны; только approved/reconciled входят в actual paid и официальный расход, pending не выдаётся за выплату |
| PAY-02 | Подтверждённая выплата M1; собственный подотчёт, сводка заказа, табель/команда, другой период/цикл | Одна исходная выплата ровно один раз в соответствующих итогах; правильные дата/цикл/Employee/account; чтение не создаёт expense/attendance/funding |
| PAY-03 | M1/M2 в одном заказе, чужой account/expense/file; user с order read, user с отдельным finance view | Own scope не открывает чужой ledger или payout proof; order aggregate и чужие персональные счета проверяются отдельно; finance grant имеет только документированный scope |
| PAY-04 | Право инициировать/редактировать payout, но actor пытается сам approve; reviewer без нужного права; grant/revoke в старой форме | Независимое согласование и действующий access проверяются сервером; выдача права не auto-approves pending expense |
| PAY-05 | Повтор, approve/approve, approve/reject race, correction/reversal, закрытый период | Один финансовый эффект; проведённые факты сохраняются, исправление компенсирует; нет фиктивного выхода или дублирующего расхода ради согласования сумм |
| PAY-06 | Receipt из оплаты заказа, затем payout; company destination/нулевой платёж; повтор обработки | Receipt поступает нужному User один раз; company/zero не пополняют личный счёт; payout — отдельный expense, не повтор receipt и не начисление |
| PAY-07 | ACL migration/чтение отчёта при существующих snapshots, manual values, approved history | Нет скрытого пересчёта ставок/начислений, изменения официального остатка или переписывания старых циклов |
| PAY-SPECIFIC | Заказ/экран, где пользователь не видит выплату | **Unresolved: точный заказ и экран не сообщены.** Нужны исходный payout id/документ, account User, Employee, дата/цикл/статус и ожидаемый экран/итог. Общие PAY-тесты не закрывают этот случай |

Rollout фиксирует ранее найденную подтверждённую выплату у Дроздовского; это внешнее исходное наблюдение плана, не проверка E. Нельзя объяснять все расхождения pending-статусом. OQ-144 о договорных суммах/наличном расчёте остаётся открытым; новую денежную формулу не изобретать.

## UI unit-тесты после API C/B

| ID | Проверяемое поведение | Граница доказательства |
| --- | --- | --- |
| UI-01 | Role-derived value, allow/deny/default, source/scope, «Вернуть по умолчанию»; parent deny и неэффективный child | UI отражает серверный effective result; не выводит его самостоятельно из роли |
| UI-02 | Preview ответа и payload сохранения, обязательная причина, stale version, изменённый draft после preview | Не отправляется устаревший impact; conflict сохраняет draft и требует актуального preview; нет оптимистического обещания доступа при отказе |
| UI-03 | Grant/revoke refresh в открытой сессии, старый ответ после нового, failed save/failed refresh | Нет возврата устаревших capabilities; ошибка чтения после успешного commit не маскируется повторным grant; старый открытый action корректно сообщает отказ API |
| UI-04 | Registry search/filter, права/назначения/история, запрет управления non-founder | Доступные элементы и источник понятны; unit-тест не считается доказательством серверной защиты |
| UI-05 | Order shipment assigned/unassigned/closed и payout approved/pending/own rendering | Действия и суммы соответствуют API; UI не раскрывает скрытые финансовые поля и не считает начисление выплатой |

Новые UI unit-тесты размещаются рядом с принадлежащими C моделями после согласования конкретных путей. Loaded-data, длинные ФИО, narrow/wide, zoom, клавиатура, focus/scroll — отдельная ручная приёмка основного агента; unit-тесты её не закрывают.

## Полный охват и порядок передачи

После реестра A каждая его строка получает: исходное правило/путь → стабильный action code → policy B → UI/API/каналы → положительный и отрицательный test id → фактический результат с командой/датой. До такой привязки строка не считается covered. Первая волна не ограничивает общий объём.

| Пакет | Обязательное покрытие сверх пилота |
| --- | --- |
| Объекты и контрагенты | Core/ops, контакты, материалы, история/redaction, бюджет/ставки/коэффициент, staffing/attendance/planning; связь order/master не расширяет visibility |
| Заказы | Создание/авторство/assignments, lifecycle, ТЗ и snapshot, фото, review, team/табель, финансы, availability и order calendar |
| Склад, оборудование, ковры | Scoped/global actions, каталоги, history/files/export, corrections, approvals; расходник не равен equipment или ковру |
| Сотрудники и кандидаты | HR/private fields/docs, destructive actions, конвертация без User/assignment, multi-manager SLA и legacy deny |
| Табели, календари, планы, замещения | Own/assigned/selected/all, private reasons, financial correction, export, срок/отзыв и actor identity |
| Задачи, approvals, чаты | Entity scope, independent resolver, room membership/admin/search/realtime; object comments остаются отдельным контуром |
| Dashboard, поиск, файлы, уведомления, settings/account/session | Сводки и метаданные, косвенные каналы, auth freshness и существующие пользовательские операции по реестру A |

Опубликованы и прочитаны B: `users-access/access-action-catalog.ts`, `types/access-policy.type.ts`, `utils/access-policy.util.ts` (`decideAccess`, `buildAccessWhere`), admin controller/service/DTO и founder resources picker. D: scoped shipment controller; `requestId` теперь optional для старого клиента, явный UUID используется для retry, при отсутствии ключ генерируется сервером для каждой отдельной операции. Ответ сохраняет flat `inventoryItemId`/`oneTimeOrderId` вместе с `inventoryItem.id`/`relatedOneTimeOrder.id`. Публикация контракта не означает проверенность всех его потребителей.

Основной агент запускает изолированные интеграции/CI последовательно. E тяжёлые запуски не выполняет. Для каждой выполненной проверки фиксируются реальный файл/test name, команда, окружение, результат и оставшиеся ограничения. Полный проход не закрывается по одному unit-прогону или пилотному модулю.

## Фактические результаты — 2026-11-06…07

Локальный лёгкий прогон E, без AppModule, сетевых соединений, Redis, БД, migrations и seed:

```sh
cd /Users/dmitrijkruckov/Desktop/service-ops-crm/apps/backend
node --import tsx --test test/access-control-policy.test.ts test/access-control-side-channels.test.ts test/access-control-realtime.test.ts
```

Исторический наблюдаемый результат E этой команды: **35 tests, 35 pass, 0 fail, 0 skipped**; main подтвердил такой же повторный результат. После добавления leaf/root notification tests E отдельно выполнил `node --import tsx --test test/access-control-side-channels.test.ts`: **17/17 PASS**. Последний полный unit-результат main — **42/42 PASS** (policy 23, realtime 2, sidechannels 17). Точная команда последнего прогона main не сообщена; показанная команда — выполненная E ранее, а не реконструкция команды main. Эти результаты относятся к составу тестов до следующего delta parent-file/chat/delegation.

| Реальный файл (`apps/backend/test/`) | Результат | Привязка к матрице и предел доказательства |
| --- | --- | --- |
| `access-control-policy.test.ts` | 23/23 PASS | AC-02…09, части AC-01/14: baseline legacy boolean, scopes, child/parent deny, неизвестные code/scope, invariant/parent false, candidates legacy deny, ограничения согласующих, domain identity отгрузки. Проверена логика helper и форма предиката в памяти; **не подтверждает Prisma/SQL-фильтрацию** |
| `access-control-side-channels.test.ts` | 17/17 PASS | Разрешение настоящих domain ancestors; свежий subject; recipient/dismiss invariants; root deny → task/completion, inventory/equipment и order expense/funding; approval source descendants и разрешённые контрольные записи. Leaf reports.read all/selected скрывает только отчёт; объект/arrival/comment/task сохраняются. Scoped specification deny скрывает item и `one_time_order.specification_updated`, чей entityId — ID заказа; другие события заказа сохраняются. Mock `findMany` фильтрует fixture по WHERE, включая `approvalRequest`; security-ожидания не ослаблены. Не подтверждает SQL, HTTP counts или реальные доставки |
| `access-control-realtime.test.ts` | 2/2 PASS | AC-13 и realtime: фактический fan-out `ChatRealtimeService` со stub-зависимостями проверяет fresh subject, отзыв read/messages/realtime, membership, closed room, objects parent deny и operation_manager exclusion. Не выполняет реальный WebSocket/JWT-handshake, Redis или полный queued-notification workflow |

Предыдущие ошибки unknown/unsupported scope и пропущенные descendants закрыты указанными unit-проверками после исправлений владельцев исходников. Критическое расхождение Prisma с JS-трактовкой пустых предикатов затем отдельно проверено реальными SQL truth cases (19/19 по сообщению main ниже), а не объявлено закрытым по unit-эмулятору.

| Реальный интеграционный файл (`apps/backend/test/`) | Текущее evidence / статус |
| --- | --- |
| `access-control-where.integration.test.ts` | **19/19 PASS**, сообщил main: 18 truth-table subtests + общий test. Реальные Prisma `findMany/count/aggregate`, выборка только по собственным fixture-ID. Включены false `OR:[]`, `{}` + selected allow сохраняет all, deny-all/невыразимый deny → zero. Это отдельный DB-прогон, не часть aggregate четырёх файлов ниже |
| `access-control-admin.integration.test.ts` | **10 PASS**, подтвердил main в финальном DB aggregate: 9 HTTP-subtests + общий test. Preview/save/actor+target ownership/tampering/expiry/replay, versions/race, unknown IDs/scopes, причины/аудит, parent deny/default baseline, legacy negative и founder resources types/aliases/ids/q/soft-delete/manager deny. Last-founder также через auth.access/login/me/refresh; inactive и login-denied founder не считаются пригодным fallback. Ранний прогон 8/9 с HTTP500 на advisory-lock был не финальным; после исправлений B и TS-аннотации теста получен текущий PASS |
| `access-control-order-inventory.integration.test.ts` | **9 PASS**, подтвердил main в DB aggregate. Authoritative baseline `986a5a1`: default active assignment разрешает отгрузку независимо от system role, включая operation_manager/manager; удаление allow сохраняет baseline. Отзыв через explicit assigned/all deny либо снятие назначения; снятие deny возвращает 201. Проверены parent deny, невозможность создать assignment через selected/all grant, retry/race/payload conflict/replay после deny, closed order и stock race. Старый payload без requestId сохраняет flat и nested поля; два самостоятельных вызова получают разные серверные UUID |
| `access-control-finance.integration.test.ts` | **2/2 PASS**, сообщил main после исправления fixture. Исторический первый прогон: PAY-04 PASS, PAY-01 FAIL (общий manual_issue ошибочно ожидался в order summary). E проверил контракт фильтра funding по orderId и исправил fixture на `one_time_order_receipt` с ID тестового заказа; ожидания 2000 до approval и 1500 после выплаты сохранены. Новый результат закрывает этот fixture-failure; конкретный пользовательский заказ по-прежнему неизвестен. Это отдельный DB-прогон, не часть aggregate четырёх файлов |
| `access-control-side-channels.integration.test.ts` | **5 PASS**, подтвердил main в DB aggregate: 4 HTTP-subtests + общий test. Search/recent возвращают только доступные domain items; фильтрация notification list/unread count до pagination/count; original/thumbnail/preview/retry и отдельные file capabilities; снятие source assignment без explicit deny скрывает сохранённое уведомление в прежней сессии. Ранний search-failure был ошибкой теста: JSON всего ответа содержал публичный input echo `query`; исправлена проверка `items`, дополнительно исключены forbidden object/task IDs и сохранён полный типизированный JSON для диагностики. **Input echo не классифицируется как production-утечка** |
| `global-search.integration.test.ts` (существующий) | **1 PASS**, подтвердил main в том же DB aggregate; E этот файл не менял |

**Финальный aggregate main: 25 PASS / 4 isolated schemas** — admin 10 + INV 9 + sidechannels 5 + existing global-search 1. Источник: прямое сообщение main «Main aggregate DB4 suites PASS25tests/4isolatedschemas». E эти DB-запуски не выполнял. Результаты SQL truth 19 и finance 2 приведены отдельно и не прибавлены к этому aggregate.

### Команды и происхождение evidence

Точные команды/полный лог DB-запусков main в чат E не переданы. Поэтому ниже — **команды воспроизведения по опубликованному runner, не утверждение о точном argv завершённого main-процесса**. E их не запускал:

```sh
cd /Users/dmitrijkruckov/Desktop/service-ops-crm
pnpm --filter backend test:integration -- test/access-control-admin.integration.test.ts test/access-control-order-inventory.integration.test.ts test/access-control-side-channels.integration.test.ts test/global-search.integration.test.ts
pnpm --filter backend test:integration -- test/access-control-where.integration.test.ts
pnpm --filter backend test:integration -- test/access-control-finance.integration.test.ts
```

Окружение подтверждённых main DB-прогонов — локальные isolated schemas; проверка guard присутствует в новых E-файлах. Не запускать команды против production. Полный raw-log/точный argv main требуется приложить отдельно, если нужен независимый replay-аудит выполнения, а не только подтверждение результата координатором.

### Незакрытая следующая очередь

На время backend build и UI pilot текущие тесты заморожены. `access-control-chat-search.integration.test.ts` написан (room-scoped search/messages/read/access deny, cursor, восстановление и global search deny), но **результат запуска не получен**; он не входит в 25/4. Новый точный parent-file case («нет root order access + selected specification.read → attached file denied; grant root read → positive»), дополнительные nested DTO report/comment/photo/spec/files/read/update tests и fresh delegation/expiration/own-rights unit tests ещё **не добавлены/не выполнены**. Новый `notification-source-visibility.ts`/resolver/ALS не объявляется полностью проверенным старым unit-прогоном: assignment-revoke имеет реальное HTTP evidence выше, дополнительные supported source types/delegation требуют следующего delta. Существующие ограничения notifications вне поддержанных core sources не считаются закрытыми.

Проверка ESLint новых/исправленных тестов и `git diff --check` выполнены E без ошибок. По последнему сообщению main backend build — следующий этап; подтверждённого результата сборки, UI pilot/live и полного CI у E нет. Новые UI unit-тесты E и ручная UI-приёмка не выполнены. Конкретный пользовательский случай отсутствующей выплаты по-прежнему **unresolved**: заказ/экран не указан. Никакие результаты этого раздела не подтверждают production-права, выкладку или полный охват всех существующих действий и модулей.

### Следующее delta и freeze — 2026-11-07 00:23:40 MSK

Этот раздел обновляет предыдущую историческую очередь, не меняя происхождение её результатов. Main отдельно сообщил **49/49 PASS** трёх unit-файлов (policy 23 + realtime 2 + sidechannels 24). Прежний результат E **50/50 PASS** включал четвёртый файл `apps/backend/test/access-control-file-parent.test.ts` с одним тестом: это другой состав, не расхождение счётчика main.

После новых employee/chat/HR/materials проверок E выполнил точную команду:

```sh
cd /Users/dmitrijkruckov/Desktop/service-ops-crm/apps/backend
node --import tsx --test test/access-control-policy.test.ts test/access-control-realtime.test.ts test/access-control-side-channels.test.ts test/access-control-file-parent.test.ts
```

**57/57 PASS, 0 fail, 0 skipped**, затем main независимо подтвердил **57/57 PASS** этих четырёх файлов и backend tsc PASS. Точный argv tsc main не передан. Новая разбивка: policy 23, realtime 2, sidechannels 29, file-parent 3. E не запускал AppModule, DB, migrations, seed или тяжёлые suites. ESLint четырёх изменённых/новых файлов (side-channels unit, file-parent unit, chat-search HTTP, nested-dto HTTP) и проверка whitespace diff прошли без ошибок.

| Delta | Evidence и граница |
| --- | --- |
| `access-control-side-channels.test.ts`, 29 unit | Моки содержат сохранённые distinct notification refs и реальные relation fixtures, а не synthetic supported rows при пустых refs. Положительная allowlist блокирует новые source IDs после снимка; null/other types сохранены явно. Проверены delegation expiry со свежим resolver/изолированным ALS и независимые own rights; HR profile/report-only исключения; deny HR extension не отменяет own/assigned report. Employee selected read не обходит deletedAt. Chat-room sources используют ID комнаты, активных участников, role/assignment baseline и parent module deny; leave отзывает сохранённый source в прежнем subject, all-grant не создаёт membership, messages.read deny скрывает message_received, сохраняя room update. Это unit с интерпретатором WHERE, не SQL/HTTP/delivery proof |
| `access-control-file-parent.test.ts`, 3 unit | Настоящий `FilesService`, storage stub: specification child allow без positive order read не достигает storage; root read включает original; parent deny снова блокирует. Materials deny блокирует original объекта, но не report/comment/arrival files; objects.read deny блокирует их все. HR report extension deny блокирует чужой unassigned report, но не независимое ownership; reports.read deny блокирует и владельца. Это не HTTP и не реальный storage |
| `access-control-chat-search.integration.test.ts` | **READY, DB-результат ещё не получен.** Room-scoped search/messages/read/access deny, cursor, control room, restore/global deny. Добавлен сохранённый notification с настоящими `chat.message_received` + `entityType: chat_room` + ID комнаты, без текста сообщения в payload: до выхода 2; после HTTP leave в прежнем cookie list/count дают 1, скрытый read 404 не меняет сохранённую запись, прямое message read запрещено |
| `access-control-nested-dto.integration.test.ts` | **Новый отдельный файл READY/FROZEN; DB не запускался.** Четыре order leaf DTO report/comment/photo/spec: leaf deny, files.read attachment redaction, доступный контроль, restore; reports.update deny сохраняет read и исходный DB report; parent module deny сильнее child grants; реальный HTTP original запрещён при selected spec grant без root, root read даёт positive, root deny отзывает. Отдельные object files: materials deny блокирует root original и сохраняет child originals; HR extension deny не отменяет ownership/assignment, reports.read deny запрещает. Для object report создаётся реальный stored file через upload, затем ровно одна fixture-связь переносится с comment на report без альтернативной root-связи; report staging workflow этим тестом не проверяется |

Поддержка source allowlist расширена исходниками main до 14 типов (core 12 + employee + chat_room). Проверенные положительные fixtures и отдельные отрицательные cases не означают полного покрытия всех producer/event variants. Неизвестные/неподдержанные sources не объявляются защищёнными новым allowlist-контрактом. Реальные Redis/WebSocket доставки, весь frontend и полный CI не подтверждены этим unit delta.

Main сообщил локальные UI результаты отдельно: admin save/audit/adaptive 390/768/1600 PASS; inventory pilot на disposable `access_ui_81908` с operation_manager, assigned open order, dialog quantity 2, save 201, одной ledger issue 2 шт/100 и правильным менеджером, responsive 390/1280 PASS. Это evidence main указанной UI-сборки, скомпилированной **до нового notification delta**, не end-to-end подтверждение последних sources. Точное argv/raw-log UI не передано.

Тестовые файлы E заморожены на указанном timestamp. Main сообщил о начале последовательного нового пакета из восьми DB suites; результатов этого пакета пока нет. Исторические DB 25/4, SQL truth 19, finance 2 остаются evidence предыдущих составов, а не результатом текущей очереди. Production не изменялся. Общий rollout/all-rights и конкретный неизвестный денежный случай не объявлены завершёнными.

### Коррекция baseline Employee и joinedAt delta — 2026-11-07

Предыдущее ожидание unit «Employee selected read не обходит deletedAt» **не являлось каноническим invariant**. Оно отражало временный source-фильтр, который main удалил после сверки `EmployeesService.getById`: карточка архивного Employee остаётся читаемой при действующем праве. E исправил test contract: без права скрыты обе записи; selected `employees.view` разрешает active и archived карточки; selected deny скрывает только запрещённую archived запись, а `employees.access` deny — обе. Исторический PASS57 не следует трактовать как доказательство необходимости deletedAt-фильтра или как privacy-регрессию после его удаления.

Дополнительно добавлен unit для отдельной HR-profile ветки `objects.view_hr`: deny extension скрывает чужой неназначенный объект, но оставляет независимое ownership/active assignment; явный `objects.read` deny запрещает и их. HR-report extension проверяется отдельно, не смешивается с profile.

После опубликованного joinedAt-контракта mock возвращает настоящие `participants.joinedAt`, notifications имеют `createdAt`, интерпретатор поддерживает Date `gte`. Новый unit: до leave старое `chat.message_received` видно, после leave скрыто, после rejoin с новым joinedAt старое событие не возвращается; createdAt ровно joinedAt и на 1 ms позже разрешены; старый room update остаётся, контрольная комната использует собственную границу. Role/assignment baseline проверяется room-update событием; message events требуют действующего membership и его временной границы. Это проверка **notification event createdAt**, не точной даты исходного сообщения по dedupeKey.

Фактически E выполнил `node --import tsx --test test/access-control-side-channels.test.ts` из backend: **31/31 PASS, 0 fail, 0 skipped**. Полный пакет четырёх файлов после этой delta ещё не запускался E и не объявляется PASS59 по сложению. Последнее отдельное подтверждение main остаётся историческим 57/57 до delta. HTTP-файлы во время main DB-прогона E не менял; новых DB-результатов нет. В исходниках появился `manager_visit_plan`: empty-ref fail-closed охвачен, но positive source fixtures/полный контракт visit-plan этим пакетом не проверены. Неизвестные sources по-прежнему не считаются закрытыми.

### Финальный handoff E / freeze — 2026-11-07

Следующее evidence передано main после предыдущего раздела; оно заменяет статус «результатов пока нет», но не объединяет разные запуски в один aggregate.

| Запуск main | Подтверждённый результат |
| --- | --- |
| Первая попытка пакета из восьми suites | Пять suites PASS: `access-control-chat-search.integration.test.ts` 6, `access-control-side-channels.integration.test.ts` 5, candidate notifications 2, chat membership 2, employee HR 2 — **17 PASS**. Затем остановка на personal notifications; последние два файла в той попытке не запускались. Точные имена/argv трёх существующих suites в сообщении не переданы |
| Повтор personal notifications + object access + substitutions после исправления main | **7 PASS / 3 isolated schemas**: `notifications-personal.integration.test.ts` 1, `object-access.integration.test.ts` 5, `user-substitutions.integration.test.ts` 1. Точная команда приведена ниже |

Итого подтверждены **24 PASS в восьми suites между разными запусками**, а не один успешный aggregate восьми suites. E эти DB-прогоны не выполнял. Personal notifications сначала падал из-за несуществующего source object в старом fixture и отдельной регрессии repeat dismiss. Main заменил fixture на настоящий shared object и исправил повторный dismiss: internal includeDismissed только для авторизованного dismiss/source refs; повторный свежий authorized ack 201 без payload; list/count продолжают скрывать dismissed. Исправления существующих тестов/production sources принадлежат main, не E.

Точный argv последнего запуска, переданный main:

```sh
node /Users/dmitrijkruckov/Documents/Codex/2026-09-27/new-chat/outputs/team-compensation-20261103/run-local-integration.mjs test/notifications-personal.integration.test.ts test/object-access.integration.test.ts test/user-substitutions.integration.test.ts
```

**Что сохранено в новом HTTP-пакете E:**

- `apps/backend/test/access-control-chat-search.integration.test.ts`: scoped search/messages/read/access deny, cursor/control/restore/global deny и сохранённое `chat.message_received` после HTTP leave в прежнем cookie. Main сообщил **6 PASS** выше. HTTP rejoin/joinedAt boundary в этом файле **не добавлен**; он проверен только unit.
- `apps/backend/test/access-control-nested-dto.integration.test.ts`: **написан, READY/FROZEN, DB-результата нет**. Восемь subtests + общий test: четыре report/comment/photo/spec leaf cases; reports.update deny при сохранённом read; module parent deny; child specification grant без root против positive root grant; object materials и HR-extension/own/assignment file checks. Файл не включён в подтверждённые 24 PASS. Report attachment setup проверяет read, не staging workflow.
- Новые HTTP tests для task/completion-file personal-grant bypass, точного message-source timestamp/dedupeKey и всех неизвестных notification sources **не добавлены**. Новых E UI unit tests нет. Решение по `approvals.read` ожидается от пользователя; контракт и проверки не выдуманы.

Последняя проверка E перед freeze — **только scoped ESLint**, exit 0:

```sh
pnpm exec eslint test/access-control-nested-dto.integration.test.ts test/access-control-chat-search.integration.test.ts test/access-control-side-channels.test.ts test/access-control-file-parent.test.ts
```

Команда выполнена из `apps/backend`; новый unit/DB/build запуск E при handoff не выполнялся. Последний подтверждённый main unit пакет — исторический **57/57** четырёх файлов до task-file/HR-profile/joinedAt/archived/idempotency delta; точный состав команды E четырёх файлов приведён выше. E отдельно получил **31/31 sidechannels** после HR-profile/joinedAt/archived изменений; это не свежая проверка всех delta или всего backend. Все прежние evidence сохраняют свой timestamp/состав.

**После этого handoff все файлы E, включая matrix, заморожены.** Новое расширение, фоновые правки и тяжёлые запуски не выполняются до новой команды/решения пользователя. Production не изменялся. Общий rollout и конкретный неизвестный пользовательский денежный случай не объявляются завершёнными.

### Финальное evidence delta main — 2026-11-07

По отдельной команде main обновлена только matrix. Этот раздел заменяет предыдущие статусы ожидания nested HTTP и полного unit-пакета; исторические результаты выше остаются привязанными к прежнему составу.

| Проверка main | Фактический результат и предел |
| --- | --- |
| `access-control-nested-dto.integration.test.ts` | **9 PASS / 1 isolated schema**: восемь subtests + общий test. Подтверждены leaf reads report/comment/photo/spec, file redaction, update deny при сохранённом read, root deny, positive root parent для child file, object materials и HR-extension с независимыми own/assigned controls. Это отдельный targeted запуск, не часть прежних 24 PASS между запусками |
| Четыре unit-файла policy/realtime/sidechannels/file-parent после предыдущего delta | Main сообщил **59 PASS** до следующего completion-write теста. Это реальный полный прогон main, а не арифметическое сложение отдельных E-результатов |
| `access-control-file-parent.test.ts` после completion-write delta main | **4/4 PASS**, сообщил main. Main исправил parent gate через `canAccessTask` перед write invariants и добавил ограниченный unit в ранее замороженный файл E; автор этой новой delta — main. Полный пакет четырёх файлов после этого добавления **не запускался/не подтверждён как aggregate 60** |
| Финальный backend tsc | **PASS**, сообщил main; точный argv не передан. Ранее scoped ESLint main — PASS; это не новый полный lint/CI |

Точный argv targeted nested HTTP, переданный main:

```sh
node /Users/dmitrijkruckov/Documents/Codex/2026-09-27/new-chat/outputs/team-compensation-20261103/run-local-integration.mjs test/access-control-nested-dto.integration.test.ts
```

E новых запусков и изменений тестов/исходников при этой записи не выполнял. Новые HTTP task/completion-write или точные message-source timestamp/dedupeKey cases не объявляются покрытыми этим unit. UI pilot процессы закрыты и disposable schema `access_ui_81908` проверенно удалена по сообщению main; это не production действие.

Продуктовый вопрос **OQ-153** зарегистрирован; ответ пользователя по `approvals.read` ожидается. Поэтому нет финальной продуктовой приёмки, `all-rights complete`, полного CI или подтверждения всех неизвестных notification sources. Конкретный пользовательский денежный случай без заказа/экрана остаётся unresolved. Production не изменялся.

**Freeze восстановлен для всех файлов E, включая эту matrix.** Никаких фоновых правок, расширения тестов или тяжёлых запусков до новой команды пользователя.

### OQ-153: подтверждённый read-only grant / ограниченное возобновление тестов

Пользователь подтвердил отдельные selected/all `approvals.read` для чужих согласований **без права решения или отмены чужой заявки**. Явные source denials сохраняются. Таким образом, продуктовый выбор OQ-153 **разрешён**; прежние записи «ответ ожидается» выше — исторические. Это не утверждение о завершении runtime или прохождении новой интеграции. B опубликовал `approval-read-access.util.ts`: `approvalReadVisibilityWhere(prisma, subject, candidateIds?)` и `approvalSourceReadContext`; main подключил тот же helper к положительной видимости сохранённых approval notifications по bounded recipient refs.

До этой новой OQ-153 delta main сообщил реальный **полный 60/60 PASS** четырёх unit-файлов, включая completion-write. Это заменяет прежний статус «aggregate 60 не подтверждён», но не переносится автоматически на последующие изменения approval helper/notification fixtures. Точный переданный main argv:

```sh
node -r ts-node/register --test test/access-control-policy.test.ts test/access-control-realtime.test.ts test/access-control-side-channels.test.ts test/access-control-file-parent.test.ts
```

Новый отдельный `apps/backend/test/access-control-approvals-read.integration.test.ts` написан для main sequential run, **DB не запускался E, PASS не заявлен**. Сохранены реальные source objects и approval requests, новый manager без resolver authority и cookie, полученный до grants. Проверяются:

- baseline own read/cancel capability при отсутствии foreign read/decision;
- selected и all foreign detail/list, own additive baseline, selected IDs именно approval IDs;
- count/page и unpaged list, поиск по fixture marker, скрытая newest row и страницы за пределами результата;
- approve/reject/foreign cancel 403 при обоих read scopes, отсутствие изменения сохранённой заявки и successful decision audit;
- selected objects.read/access deny сильнее approval all grant, включая собственную заявку, с независимым control source и восстановлением;
- approval-specific selected deny, live grant/revoke/default в прежней сессии;
- сохранённые `approval_request` notifications: baseline own → selected → revoke → all → source deny → restore/default, list/count до pagination, hidden read 404 без acknowledgement и сохранение всех unread records.

Существующий `apps/backend/test/approvals-search.integration.test.ts` изменён **только в fixture** по разрешению main: создан настоящий Object, `sourceEntityId` ссылается на него вместо несуществующей строки. Ожидания поиска не изменены. Команда, предназначенная для main (не выполнена E):

```sh
node /Users/dmitrijkruckov/Documents/Codex/2026-09-27/new-chat/outputs/team-compensation-20261103/run-local-integration.mjs test/access-control-approvals-read.integration.test.ts test/approvals-search.integration.test.ts
```

После новой positive approval notification visibility main сообщил о четырёх failures старых sidechannel fixtures: unrelated approval ошибочно считалась доступной manager без собственного авторства/legacy authority. По отдельному разрешению E исправил только fixture `access-control-side-channels.test.ts`: собственные reader approval rows с `approvalType`, настоящий независимый `object-outside` control source. Все прежние unrelated-positive и parent-deny assertions оставлены. E выполнил `node --import tsx --test test/access-control-side-channels.test.ts`: **31/31 PASS**, без DB/AppModule; это не новый полный aggregate 60 и не HTTP evidence нового helper.

E не менял production sources, schema/seed или денежные формулы. OQ-153 read-only контракт не является разрешением на чужие decisions. Полный rollout/all-rights, production и конкретный неизвестный денежный случай не объявляются завершёнными.

Scoped ESLint `test/access-control-approvals-read.integration.test.ts test/approvals-search.integration.test.ts test/access-control-side-channels.test.ts` и `git diff --check` завершены E без ошибок. **READY/FREEZE нового сохранённого пакета: 2026-11-07 00:56:55 MSK.** HTTP/DB ожидает main; E не выполняет фоновые правки и тяжёлые запуски.

### Bounded Terra P1/P2 delta и актуальный freeze — 2026-11-07 00:59:50 MSK

По дополнительному поручению main в новый approval HTTP-файл добавлены только найденные регрессии:

- Soft-deleted object → linked task approval: сохранённая object identity позволяет explicit root read deny скрыть detail/list и сохранённое approval notification; восстановление source/снятие deny возвращает positive control.
- Реальный compensation adjustment с primary/replacement Employee и amount/name payload: selected deny `employees.view` для каждого связанного Employee либо `objects.rates.read` для объекта скрывает approval detail/list и notification, включая count, но не unrelated root approval. Read-only сценарий не применяет adjustment и проверяет неизменность сохранённого source.
- Selected `objects.materials.read` deny **не скрывает** root object-change approval/notification, когда object card readable; list total/unread count остаются прежними. Проверяется отсутствие чрезмерного ancestor exclusion, не обход materials file gate.

Отдельно в `access-control-file-parent.test.ts` добавлен unit lifecycle: archived object report с HR extension и all-read grants не достигает storage; восстановление active lifecycle даёт positive control. E выполнил этот файл: **5/5 PASS**. Затем main подтвердил **реальный полный 61/61 PASS** всех четырёх unit-файлов после fixture correction и archived HR file delta. Это новый полный прогон, не сложение отдельных результатов; исторические 60/60 выше остаются до последнего добавления. Состав файлов тот же policy/realtime/sidechannels/file-parent; точный повторный argv main отдельно не сообщил, ранее сообщённый argv с `ts-node/register` приведён выше.

После последних HTTP/unit additions E выполнил scoped ESLint нового approval integration и file-parent unit и `git diff --check`: exit 0. Новые HTTP/DB проверки E не запускал и PASS для approval-read integration пока не заявлен.

**READY/FROZEN для main sequential DB:** `test/access-control-approvals-read.integration.test.ts` и fixture-corrected `test/approvals-search.integration.test.ts`. Предназначенная команда runner приведена в предыдущем разделе. Все четыре unit-файла также frozen. После этой записи matrix заморожена; никаких дополнительных cases, source edits, фоновых правок, тяжёлых запусков, commits или production действий E не выполняет. OQ-153 продуктово разрешён, но финальная runtime/all-rights приёмка не подменяется этим evidence.

### OQ-153: фактический DB результат main — 2026-11-07

Финальная команда main завершилась **exit 0: 15 PASS / 2 isolated schemas**:

```sh
node /Users/dmitrijkruckov/Documents/Codex/2026-09-27/new-chat/outputs/team-compensation-20261103/run-local-integration.mjs test/access-control-approvals-read.integration.test.ts test/approvals-search.integration.test.ts
```

| Durable test file | Результат main |
| --- | --- |
| `access-control-approvals-read.integration.test.ts` | **14/14 PASS**, 13 subtests + общий test. Selected/all foreign read; own baseline; count/page/search; отказ read-only actor в approve/reject/foreign cancel без изменения заявки; explicit approval/source denies; прежний cookie; сохранённые notification hide/show/count/page; archived ancestor identity + deny; compensation Employee/rates denials; materials denial не скрывает readable root approval notification |
| `approvals-search.integration.test.ts` | **1 PASS**, прежние search assertions с настоящим Object source fixture |

Первый запуск новой suite имел **12 PASS / 2 FAIL**, считая общий parent: единственный failing subtest пытался сохранить allow и selected deny для одинакового user/action, нарушая DB unique constraint. Это ошибка fixture, не production access failure. E заменил невозможную комбинацию проверкой selected deny поверх временного настоящего `approval.resolve_object_change` permission. Перед deny подтверждён inherited read, после deny HTTP 404/count уменьшается, own/control positives сохранены, снятие deny восстанавливает доступ. Permission и правило очищаются в `finally`, проверено отсутствие наследованного foreign read после cleanup. Scoped ESLint/diff-check прошли; тест заморожен 01:01:33 MSK. Main rerun выше — финальное evidence, закрывающее этот fixture failure.

Main также сообщил backend tsc PASS после последних sources, frontend tsc PASS после C copy changes и targeted backend/frontend ESLint PASS. Точные argv этих проверок не переданы; это не полный CI, UI/live прогон или доказательство всех модулей.

Ad-hoc probe B «source21» **не является durable test/file**: его нельзя считать дополнительной suite, прибавлять к 15/2 или выдавать за репозиторное regression coverage. E не добавлял его как тест.

Последовательный main regression пакет завершён **exit 0: 8 PASS / 3 isolated schemas**: finance HTTP — 2, sidechannels HTTP — 5, personal notifications — 1. Точный argv:

```sh
node /Users/dmitrijkruckov/Documents/Codex/2026-09-27/new-chat/outputs/team-compensation-20261103/run-local-integration.mjs test/access-control-side-channels.integration.test.ts test/notifications-personal.integration.test.ts test/access-control-finance.integration.test.ts
```

Повторные проверки подтверждают неизменность денежного факта до согласования, запрет согласования собственной выплаты, фильтрацию поиска/файлов/уведомлений и идемпотентное скрытие прочитанного уведомления. Общий точный unit argv main (61 PASS): `node -r ts-node/register --test test/access-control-policy.test.ts test/access-control-realtime.test.ts test/access-control-side-channels.test.ts test/access-control-file-parent.test.ts`. Backend/frontend: `pnpm exec tsc --noEmit`, каждый в своей директории — exit 0. Финальный `git diff --check` — exit 0.

Terra адресно перепроверил исправления архивного предка, lifecycle файлов, чувствительных полей начислений и notification parity; новых блокирующих замечаний по OQ-153 не выявил. Это review кода с учётом результатов main, а не самостоятельный повтор тестов или approval всех прав системы.

Все тесты E остаются frozen; main обновил только итоговое evidence. Production не изменялся. OQ-153 approved read-only выбор и данный targeted PASS не означают `all-rights complete`, финальную приёмку всего rollout или разрешение решений по чужим согласованиям. Конкретный неизвестный пользовательский денежный случай остаётся unresolved.
