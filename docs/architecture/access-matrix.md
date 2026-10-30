# Access Matrix

Уточнение новой разработки 2026-10-28: договорная сумма объекта видна только четырём leadership-ролям, включая API и историю. Управление плановыми позициями/группами наследует действующий объектный operational scope, но создание/смена их денежных условий требует существующего права управления ставками. Операционное подтверждение смены не разрешает менять её цену или ручной итог дня. Для коэффициента вводится узкая capability `object.coefficient_edit`, выдаваемая только согласованным аккаунтам Лебедева и Герасимова; runtime не вычисляет право по свободному ФИО. Существующее редактирование бюджета и ручная корректировка табеля сохраняют собственные ограничения. Подробности и статус — [контракт](../product/object-setup-contract-2026-10-28.md), [план](../product/object-creation-workgroup-2026-10-28.md).

## Назначение документа

Этот документ фиксирует каноническую матрицу доступа на текущем этапе.
Если в runtime есть иное поведение, оно считается drift до отдельного исправления.

---

## 1. Канонический leadership circle

В leadership circle входят:

- `founder`
- `deputy_founder`
- `director`
- `corporate_director`

Не входит по умолчанию:

- `deputy_director`

---

## 2. Канонические слои доступа

### 2.1. System role

Глобальная системная роль пользователя.

### 2.2. Object assignment

Назначение на конкретный объект:

- `responsible`
- `manager`

### 2.3. Order assignment

Назначение на конкретный разовый заказ:

- `one_time_manager`

### 2.4. Capability

Дополнительное адресное право на чувствительное действие.

---

## 3. Objects access matrix

| Action                 | founder | deputy_founder | director | corporate_director | deputy_director        | responsible                                                    | manager |
| ---------------------- | ------- | -------------- | -------- | ------------------ | ---------------------- | -------------------------------------------------------------- | ------- |
| View object core       | yes     | yes            | yes      | yes                | yes operationally      | yes                                                            | yes     |
| Create object          | yes     | yes            | yes      | yes                | no                     | no                                                             | no      |
| Edit object core       | yes     | yes            | yes      | yes                | no                     | no                                                             | no      |
| Freeze object          | yes     | yes            | yes      | yes                | no                     | no                                                             | no      |
| Change object status   | yes     | yes            | yes      | yes                | no                     | no                                                             | no      |
| Manage responsibles    | yes     | yes            | yes      | yes                | no                     | no                                                             | no      |
| Manage object managers | yes     | yes            | yes      | yes                | no                     | limited by object workflow only if explicitly introduced later | no      |

Каноническое правило:

- `Responsible` не получает object core edit по умолчанию.

Если backend сейчас это разрешает, это runtime drift.

---

## 4. Object operational access matrix

| Action              | leadership circle | responsible | manager |
| ------------------- | ----------------- | ----------- | ------- |
| Arrival photo       | yes               | yes         | yes     |
| Daily report        | yes               | yes         | yes     |
| Object comments     | yes               | yes         | yes     |
| Staffing management | yes               | yes         | yes     |
| Attendance marking  | yes               | yes         | yes     |

---

## 5. Budget / compensation / finance

| Action | founder | deputy_founder | director | corporate_director | deputy_director | responsible | manager |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View financial block | yes | optional by visibility/capability | yes | optional by visibility/capability | view only if granted | scoped | scoped |
| Edit object budget | yes | no by default | yes | no by default | no | no | no |
| Manage default, summer and winter object compensation profiles | yes | yes | yes | yes | yes | no | no |
| Create/edit named employee rate options, including substitution rates | yes | yes | yes | yes | yes | no | no |
| Assign employee rate option or individual compensation | yes | yes | yes | yes | yes | no | no |
| Select an existing active pay condition for an object staffing position | yes | yes | yes | yes | yes | scoped, writable object | scoped, writable object |
| Record a manually priced extra shift for an employee on the assigned object | yes | yes | yes | yes | yes | no | yes, assigned object only; amount and reason required; management notified |
| Edit/clear a historical attendance rate override | founder | no by default | director | no by default | no | no | no |

`deputy_director` receives this explicit narrow rate-management grant but remains outside the leadership circle. It does not grant object-core edit, budget edit, approval authority, or manual historical timesheet correction. Managers can view rates but cannot create conditions, edit amounts or arbitrarily reassign individual employee rates. Clarification 2026-10-29 (OQ-149): a scoped manager may select any existing active condition of that object in a staffing position through `selectPayConditions`, separately from `manageRates`. Recording a new object-scoped extra shift with amount and reason remains a separate existing exception. Changes are audited; prior facts are not rewritten.

Дополнительные финансовые действия могут выдаваться capability-моделью.

---

## 6. Timesheet access matrix

### 6.1. Base timesheet access

| Action                                       | leadership circle | deputy_director              | responsible | manager |
| -------------------------------------------- | ----------------- | ---------------------------- | ----------- | ------- |
| View timesheet                               | yes               | yes if allowed operationally | yes         | yes     |
| View/export all-object monthly overview      | yes               | yes                          | scoped      | scoped  |
| Operate attendance-linked timesheet workflow | yes               | yes if allowed operationally | yes         | yes     |

### 6.2. Manual correction

| Action                                                                   | founder | director | deputy_founder | corporate_director | deputy_director | responsible    | manager        |
| ------------------------------------------------------------------------ | ------- | -------- | -------------- | ------------------ | --------------- | -------------- | -------------- |
| Manual timesheet correction by default                                   | yes     | yes      | no             | no                 | no              | no             | no             |
| Manual timesheet correction via capability `timesheet.manual_correction` | yes     | yes      | yes if granted | yes if granted     | yes if granted  | yes if granted | yes if granted |

Каноническое правило:

- общий доступ к табелю не равен праву на manual correction.

Если runtime сейчас разрешает manager/responsible менять ячейки табеля вручную только на основании общего доступа, это runtime drift.

---

## 7. Tasks access matrix

| Action      | leadership circle                           | responsible                                 | manager                                     | one_time_manager                            |
| ----------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| View task   | yes                                         | yes by scope                                | yes by scope                                | yes by scope                                |
| Create task | yes                                         | yes by scope                                | yes by scope if allowed                     | yes by order scope                          |
| Close task  | routed through approval / confirmation flow | routed through approval / confirmation flow | routed through approval / confirmation flow | routed through approval / confirmation flow |

Каноническое правило:

- закрытие задачи требует подтверждения.
- `deputy_director` имеет широкий operational task access: может создавать задачи и выбирать назначаемых не только в объектах, где назначен manager.

---

## 8. Inventory exception rule

### 8.1. Inventory runtime bridge for Sprint 6

| Action                         | leadership circle | deputy_director | manager | one_time_manager | hr |
| ------------------------------ | ----------------- | --------------- | ------- | ---------------- | -- |
| View inventory module          | yes               | yes             | no      | no               | no |
| Manage inventory catalog       | yes               | yes             | no      | no               | no |
| Create receipt / issue / return| yes               | yes             | no      | no               | no |
| Object-scoped issue_to_object  | yes               | yes             | yes if assigned to object | no | no |
| Create writeoff                | yes               | yes             | no      | no               | no |
| Create adjustment              | yes               | yes             | no      | no               | no |
| View inventory reports         | yes               | yes             | no      | no               | no |
| Resolve object issue without photo | director only | no | no | no | no |

Переходное правило:

- object или one-time-order linkage внутри movement не расширяет их карточечную visibility автоматически;
- `deputy_director` может выбрать объект/заказ как цель движения, но это не означает автоматическое право открыть карточку объекта/заказа.

Для `issue_to_object` без фото подтверждает:

- `director`

Это отдельное каноническое правило MVP.

## 9. Equipment runtime bridge for Sprint 7

| Action                             | leadership circle | deputy_director | manager | one_time_manager | hr |
| ---------------------------------- | ----------------- | --------------- | ------- | ---------------- | -- |
| View equipment module              | yes               | yes             | no      | no               | no |
| Manage equipment catalog           | yes               | yes             | no      | no               | no |
| Assign equipment to object         | yes               | yes             | no      | no               | no |
| Assign equipment to one-time order | yes               | yes             | no      | no               | no |
| Return / move equipment            | yes               | yes             | no      | no               | no |
| Mark broken / send to repair       | yes               | yes             | no      | no               | no |
| Writeoff equipment                 | yes               | yes             | no      | no               | no |
| View object-scoped equipment       | yes               | yes             | yes if assigned to object | no | no |
| View order-scoped equipment        | yes               | yes             | no      | yes if assigned to order | no |

Переходное правило:

- object/order scoped equipment blocks показывают reference без доступа к глобальной equipment card;
- object или one-time-order linkage не расширяет global equipment module access.

### 9.1. Employees / HR

| Action                            | leadership circle | hr  | deputy_director | others |
| --------------------------------- | ----------------- | --- | --------------- | ------ |
| View employee registry/card       | yes               | yes | yes             | no     |
| Create/update/archive employee    | yes               | yes | no              | no     |
| Manage employee object assignment | yes               | yes | no              | no     |

Просмотр HR-реестра ролью `deputy_director` не расширяет object visibility и не дает HR-management actions.

---

## 10. Accountability / expenses

| Action                                    | founder | director | other leadership          | others |
| ----------------------------------------- | ------- | -------- | ------------------------- | ------ |
| Issue accountability by default           | yes     | yes      | no by default             | no     |
| Issue accountability via capability       | yes     | yes      | yes if explicitly granted | no     |
| Transfer accountability to another person | no      | no       | no                        | no     |

---

## 11. Chats

| Action               | Rule                                                                |
| -------------------- | ------------------------------------------------------------------- |
| Object chat          | не вводится как отдельный чат, внутри объекта используются comments |
| General chat         | yes                                                                 |
| Regular objects chat | yes                                                                 |
| One-time orders chat | yes                                                                 |
| Substitution chat    | yes                                                                 |

Runtime уточнение:

- `deputy_director` может создавать и администрировать рабочие/custom-чаты, но не входит в `leadership` chat visibility по умолчанию.
- Глобальное закрытие группового чата выдается отдельным персональным permission `chat.room.close_global`; право не выводится из фамилии, логина или широкой роли.

---

## 12. Capability catalog

Канонические capability codes на текущем этапе:

- `timesheet.manual_correction`
- `object.budget_edit`
- `object.daily_rate_edit`
- `accountability.issue_cash`
- `expense.approve`
- `approval.resolve_task_result`
- `approval.resolve_object_change`
- `approval.resolve_inventory_exception`

---

## 13. Approval mapping

| Approval type                           | Source module           | Source entity               | Resolver                              | Capability                           |
| --------------------------------------- | ----------------------- | --------------------------- | ------------------------------------- | ------------------------------------ |
| task_result_confirmation                | tasks                   | task result                 | leadership / designated approver      | approval.resolve_task_result         |
| object_change_confirmation              | objects                 | object                      | leadership                            | approval.resolve_object_change       |
| inventory_exception_confirmation        | inventory               | inventory exception         | director / designated approver        | approval.resolve_inventory_exception |
| inventory_return_confirmation           | inventory               | inventory return            | leadership / designated approver      | approval.resolve_inventory_exception |
| inventory_writeoff_confirmation         | inventory               | inventory writeoff          | leadership / designated approver      | approval.resolve_inventory_exception |
| equipment_return_confirmation           | equipment               | equipment return            | leadership / designated approver      | approval.resolve_object_change       |
| equipment_writeoff_confirmation         | equipment               | equipment writeoff          | leadership / designated approver      | approval.resolve_object_change       |
| accountability_closure_confirmation     | expenses-accountability | accountability closure      | leadership / designated approver      | expense.approve                      |
| manual_timesheet_exception_confirmation | timesheets              | manual correction exception | leadership / designated approver      | timesheet.manual_correction          |

---

## 13. Sprint 1 closeout note

Sprint 1 closeout считается завершенным только если:

- leadership circle одинаков во всех docs и в runtime;
- object core edit соответствует этой матрице;
- timesheet manual correction соответствует этой матрице.

До этого момента расхождения считаются drift.

---

## 14. Files / media platform baseline

- чтение файла наследует visibility родительской сущности;
- upload в `object` наследует правило object core edit;
- upload в `object_arrival_photo`, `object_daily_report`, `object_comment` наследует текущий writable bridge object-operations;
- upload в `task` наследует task-scoped access;
- прямой публичный storage URL не считается каноническим access path, базовый runtime path — backend download proxy.

---

## 15. Candidates

| Action | founder | deputy_founder | director | corporate_director | deputy_director | hr | operation_manager | manager |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| View | yes | yes | yes | yes | yes | yes | all; default own | all; default own |
| Manage | yes | yes | yes | yes | yes | yes | no | no |
| Respond | yes | yes | yes | yes | yes | yes | own active assignment | own active assignment |

Уточнение 2026-10-25: право `candidates.view` даёт чтение всех кандидатов в карточке, поиске и recent-resolution. В реестре менеджер по умолчанию использует «Мои» (действующие назначения), доступен режим «Все». `candidates.manage` также разрешает обратную связь HR/руководства без назначения; она не закрывает SLA менеджера. Ответ менеджера допускается по своему действующему назначению. «Оформить сотрудником» требует `candidates.manage` и `employees.create`; назначения Employee на объект внутри сценария кандидата нет. Персональный `candidates.denied` перекрывает все три permissions: он выдан Степановой и Никитиной, действует на UI/API/поиск/уведомления и исключает выбор этих пользователей менеджерами кандидатов.

Адресные permissions `candidates.view`, `candidates.manage`, `candidates.respond` расширяют соответствующее действие в указанном scope. Назначаемый менеджер должен оставаться активным `manager` или `operation_manager` независимо от direct permission. Отметки получения паспорта/договора следуют правам создания/редактирования Employee, даты и автор назначаются сервером.
## 16. Общий календарь пользователей и календарь разовых заказов

Матрица относится к отдельному общему календарю пользователей. Она не заменяет текущий календарь разовых заказов и его контекстные права.

| Действие                                             | любой активный User | Киреева (персональный grant) | `deputy_director` | `corporate_director` | `hr` и остальные роли |
| ---------------------------------------------------- | ------------------- | ---------------------------- | ----------------- | -------------------- | --------------------- |
| Просмотр своего календаря                            | да                  | да                           | да                | да                   | да                    |
| Просмотр занятости других пользователей               | да, без причин      | да, все Users                | да, без причин    | да, без причин       | да, без причин        |
| Создание/редактирование событий своего календаря     | да                  | да                           | да                | да                   | да                    |
| Создание/редактирование событий других пользователей | нет                 | да, все Users                | нет               | нет                  | нет                   |
| Просмотр причин отсутствия других пользователей       | нет                 | да                           | нет               | нет                  | нет                   |

Только Киреева получает персональные permissions на редактирование чужих событий и приватные причины. Решение 2026-10-25 реализовано локально: остальные пользователи видят только занятость коллег, не их комментарии. Это не меняет права на календарь разовых заказов. Backend проверяет scope/target user и не раскрывает приватные поля без отдельного права.

### Персональные операционные права — 2026-10-26

- `objects.hr_reports_view`: Лазутина и Киреева читают отчёты и историю объекта. Это не разрешает финансовые поля, оперативные комментарии, посещаемость, фото прибытия или редактирование объекта. Финансовые поля вложенного audit payload скрываются рекурсивно.
- `chat.room.manage_members`: Степанова и Лебедев управляют составом доступных групповых чатов; это не открывает посторонние комнаты, переименование или удаление истории. Действующие административные права остальных ролей сохраняются.
- `visit_plans.manage`: только Лебедев и Горбачева формируют и меняют планы, посещения и отчёты. Менеджер читает свой план, руководство — планы подчинённых; чтение не разрешает изменение.
- `one_time_order.escorts.manage`: только Дроздовский и Берендяков меняют свой непустой список сопровождающих на дату и доступный заказ; сотрудники выбираются из действующего состава команды заказа. Права не наследуются по роли руководства.
- `operation_manager` не читает системную комнату `objects`, включая поиск, прямые сообщения, участников и realtime-получателей. Доступ к комнате разовых заказов не меняется.
- Коррекция выдачи расходников требует права выдачи в конкретном объекте/заказе. Простого права просмотра заказа недостаточно; closed/frozen/archived ограничения проверяются сервером.

### Дополнение: контакты, бюджет и сезонные настройки объектов

Контакты читаются в object scope и изменяются при `canEdit` с ограничениями frozen/archived объекта. Месячный бюджет меняют `founder`, `director` либо пользователь с `object.budget_edit`; общий object core edit сам по себе права бюджета не даёт. Бюджет читают пользователи с операционным доступом к объекту. Сезонные настройки меняют роли управления ставками, включая узкое право `deputy_director`. Версии контактов и настроек проверяются на сервере.

## 17. Подотчет: разделение прав

| Действие                                             | Доступ                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Просмотреть свой счет и движения                     | любой активный User в пределах собственного счета                                                                                                       |
| Создать свободный внешний приход на собственный счет | любой активный User; сумма без лимита; обязательны источник-текст и комментарий; файл необязателен; проведение немедленно влияет на официальный остаток |
| Выдать средства на счет другого пользователя         | существующий отдельный путь выдачи сохраняется; пользователь-выдавший и получатель явно фиксируются                                                     |
| Выдать аванс/деньги организации                      | только пользователи с отдельным ограниченным правом, с получателем и основанием                                                                         |
| Сверять/подтверждать расход или корректировку        | отдельное право сверки/approval; автор записи не может быть единственным подтверждающим там, где требуется независимый контроль                         |
| Изменить или удалить проведенную запись              | нельзя; только компенсирующая операция с аудитом                                                                                                        |

Свободный приход на собственный счет не является заявкой на approval: он сразу входит в официальный ledger и баланс, но остается доступен для последующей сверки. Он не должен позволять менять счет другого пользователя или создавать дубль автоматического платежа по заказу.

## 18. Объектное замещение

Замещение не является новой system role и не изменяет роль/идентичность пользователя. Эффективный доступ в выбранном объекте — union (не пересечение) собственных прав замещающего и объектных прав замещаемого. Scope ограничен явно выбранными объектами и сроком делегирования; доступ за пределами scope не выдается. Sensitive global HR/payroll/finance approval права не наследуются от объектного замещения автоматически. Все действия аудируются с действующим User и исходным пользователем, от имени полномочий которого выполнено замещение.

### Контекстные права и исключения

Делегированные права вычисляются отдельно для каждого выбранного объекта и только на время действия записи. Роль замещающего остаётся источником собственных прав; делегированная роль не добавляется в JWT, глобальную capability-модель или список ролей пользователя.

| Действие в контексте объекта | При замещении |
| --- | --- |
| Открыть объект, его операционные разделы и связанные с ним сведения | наследуется, если исходный User имеет соответствующее право |
| Редактировать профиль объекта, статус, ответственных и менеджеров | наследуется в выбранном объекте, если это право есть у исходного User |
| Создавать и вести задачи, комментарии, отчёты и материалы, привязанные к выбранному объекту | наследуется в пределах выбранного объекта и обычных правил конкретной сущности |
| Оформить складское движение, целью которого является выбранный объект | наследуется только для объектно-целевых типов движения, доступных исходному User; глобальные операции склада не открываются |
| Управлять оборудованием, закреплённым на объекте | только объектно-ограниченные действия; для переноса требуются права на оба объекта; глобальный каталог остаётся закрыт |
| Изменять ставки, табель, кадровые назначения, персональные/приватные данные сотрудников | не наследуется автоматически; требует отдельного HR/payroll права |
| Выдавать/исправлять подотчёт, подтверждать финансовые и чувствительные approvals | не наследуется |
| Открывать разовый заказ только потому, что он связан с объектом | не наследуется; заказ остаётся в отдельном scope разовых заказов |
| Получать уведомления или доступ к глобальным отчётам | не наследуется автоматически |

Эффективное право в строке — объединение собственного права заместителя и делегированного объектного права. Делегирование никогда не отнимает более широкое собственное право заместителя. Создать делегирование может сам исходный User либо отдельный администраторский permission; исходный и замещающий Users, список объектов, период, причина, отзыв и автор управляющего действия записываются в audit trail. Изменять активный scope задним числом нельзя: его следует отозвать и создать новую запись.
