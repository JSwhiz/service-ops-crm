# Product Contract

## Назначение документа

Этот документ является каноническим продуктовым контрактом текущего состояния системы и целевого full MVP.
Если другие документы содержат более старые или сокращенные формулировки, источником истины считается этот документ.

---

## 1. Системная рамка продукта

Система представляет собой внутреннюю операционную CRM для управления:

- регулярными объектами;
- разовыми заказами;
- задачами;
- табелем;
- сотрудниками;
- расходниками;
- оборудованием;
- подотчетом и расходами;
- подтверждениями;
- файлами и медиа;
- коммуникациями;
- уведомлениями;
- отчетностью.

---

## 2. Канонический leadership circle

### 2.1. Leadership circle

Канонический состав leadership circle:

- `founder`
- `deputy_founder`
- `director`
- `corporate_director`

### 2.2. Не входит в leadership circle

Следующие роли не входят в leadership circle по умолчанию:

- `deputy_director`

`deputy_director` может иметь широкий operational access в отдельных контурах, но не считается частью leadership circle по умолчанию.

---

## 3. Канонические слои ролей и назначений

### 3.1. System role

System role — это глобальная системная роль пользователя.

Примеры:

- `founder`
- `deputy_founder`
- `director`
- `corporate_director`
- `deputy_director`
- `manager`
- `senior_manager`
- `operation_manager`
- `hr`
- `sys_admin`

System role определяет глобальные права в системе.

### 3.2. Object assignment

Object assignment — это назначение пользователя на конкретный объект.

Канонические object assignments:

- `responsible`
- `manager`

Это не system roles.

### 3.3. One-time order assignment

One-time order assignment — это назначение пользователя на конкретный разовый заказ.

Канонические order assignments:

- `one_time_manager`
- при необходимости другие order-scoped assignments в следующих этапах

Это не system roles.

### 3.4. Employee

Employee — это отдельная сущность сотрудника, не равная системному пользователю.

Каноническое правило:

- `user != employee`

---

## 4. Канонические правила по объекту

### 4.1. Создание объекта

Объект может создавать только leadership circle.

Создатель объекта автоматически становится первым `responsible`.

### 4.2. Responsibles

`Responsible` — это управленческое назначение на объект.

Правила:

- responsibles назначает и снимает только leadership circle;
- объект должен иметь минимум одного responsible;
- responsible не является глобальной system role;
- responsible не получает full object core edit по умолчанию.

### 4.3. Managers объекта

`Manager` объекта — это object assignment, а не system role.

Правила:

- managers назначаются на объект;
- managers ведут операционный контур объекта;
- managers не получают object core edit по умолчанию;
- managers не входят в leadership circle автоматически.

### 4.4. Object core edit

Редактирование object core по умолчанию доступно только leadership circle:

- `founder`
- `deputy_founder`
- `director`
- `corporate_director`

`Responsible` не редактирует object core по умолчанию.

Если в runtime сейчас есть иное поведение, оно считается drift и подлежит исправлению.

### 4.5. Заморозка объекта

Заморозка объекта доступна только leadership circle.

---

## 5. Канонические правила по staffing / attendance / timesheet

### 5.1. Staffing

Staffing — это текущий состав сотрудников объекта.

### 5.2. Attendance

Attendance — это факт присутствия сотрудника в конкретную дату.

### 5.3. Timesheet

Timesheet — это учетный слой по дням и месяцам.

Канонические правила:

- staffing, attendance и timesheet — разные сущности;
- исторические строки timesheet не должны зависеть только от текущего staffing;
- backend является источником истины для автоматического значения дня.
- сводный месячный табель использует тот же `finalValue`, что объектный табель;
- `Аванс` равен сумме `finalValue` за календарные дни 1–15;
- `ЗП` равна сумме `finalValue` за календарные дни 16–конец месяца;
- просмотр сводного табеля не создает отсутствующие месячные контейнеры.
- сохраненный `TimesheetDayEntry.dayValue` является authoritative historical `finalValue` и не пересчитывается по текущей ставке;
- строка сводного табеля учитывает assignment lifecycle только если он пересекает выбранный месяц, но сохраненные строки и attendance facts остаются видимыми независимо от текущего назначения.

### 5.4. Автоматическое значение дня

Автоматическое значение дня определяется так:

- если есть attendance факт — берется `object.dailyRate`;
- если attendance факта нет — значение дня равно `0`.

### 5.5. Manual timesheet correction

Manual correction — это отдельное чувствительное действие, отличное от простого доступа к табелю.

Каноническое правило:

- доступ к просмотру/операционной работе с timesheet может быть шире;
- manual correction по умолчанию доступна только:
  - `founder`
  - `director`
- для остальных manual correction возможна только через отдельную capability:
  - `timesheet.manual_correction`

Если runtime сейчас позволяет manager/responsible менять ячейки табеля вручную только на основании общего доступа к табелю, это считается drift и подлежит исправлению.

### 5.6. Комментарий к manual correction

Любое осознанное ручное отклонение от автоматического значения требует комментария.

---

## 6. Бюджет, ставка и финансовый доступ

### 6.1. Бюджет объекта

По умолчанию бюджет объекта меняют только:

- `founder`
- `director`

Дополнительно это право может быть выдано через отдельную capability.

### 6.2. Deputy director и финансы

`deputy_director` не меняет ставку табеля по умолчанию.

Он может иметь просмотр финансовых блоков и расширенный operational access, но не получает право на изменение ставки автоматически.

### 6.3. Ставка в середине месяца

Каноническое правило:

- старые дни остаются по старой ставке;
- дальнейшие дни идут по новой ставке;
- backdated change не делается автоматически;
- если нужно исправление старых дней, это делается через табель/корректировку, а не автопересчетом истории.

---

## 7. Разовые заказы

Разовый заказ — отдельная сущность, не равная объекту.

Минимальная карточка разового заказа в MVP должна включать:

- контакты;
- менеджера заказа;
- статусы;
- участников;
- фото до/после;
- расходники;
- связанные задачи;
- финансовый блок.

one_time_manager не получает прав leadership circle и не получает автоматических прав на object core даже если заказ привязан к объекту.

Отдельный табель по разовому заказу входит в MVP как отдельный контур.

---

## 8. Расходники и оборудование

### 8.1. Расходники

Расходники и склад — отдельный контур.

Канонические правила Sprint 6:

- inventory строится как единый центральный склад;
- отдельный складской остаток на объекте не ведется;
- остаток номенклатуры вычисляется из `InventoryMovement`;
- текущая цена номенклатуры берется из последнего `receipt`;
- каждое движение хранит `unitPriceSnapshot` и `totalAmountSnapshot`;
- старые движения не пересчитываются при новом приходе с другой ценой.

Объектный расход:

- `issue_to_object` — это финальное списание с центрального склада на объект;
- назначенный менеджер объекта может выполнить `issue_to_object` в рамках своего object scope;
- фото для `issue_to_object` обязательно;
- если фото нет, движение уходит в bridge `inventory_without_photo_confirmation`;
- bridge по `issue_to_object` без фото подтверждает только `director`.
- для других движений с обязательным фото runtime использует typed state
  `inventory_missing_photo_evidence_required`; это не дает director-only resolution
  автоматически.

### 8.2. Оборудование

Оборудование — отдельный контур, не смешивается с расходниками.

Канонические правила Sprint 7:

- equipment строится как unit-based домен;
- `EquipmentCatalogItem` описывает тип/модель оборудования;
- `EquipmentUnit` описывает конкретную штучную единицу;
- текущий статус и текущая привязка хранятся materialized на unit;
- история действий хранится в `EquipmentMovement`;
- выдача на объект/разовый заказ не списывает equipment, а меняет текущую привязку;
- возврат переводит unit на склад или в проблемный статус;
- repair/broken/lost/writeoff фиксируются status transition + history entry;
- attachments для equipment-событий живут в files/storage baseline как `equipment_movement`.

Минимальные статусы unit:

- `in_storage`
- `assigned_to_object`
- `assigned_to_one_time_order`
- `under_repair`
- `broken`
- `lost`
- `written_off`

### 8.3. Разовый заказ, привязанный к объекту

Если разовый заказ привязан к объекту, операции разового заказа должны быть видны и в объекте через отдельный блок вида:

- `Из разового заказа`

Там должны отражаться:

- факт списания;
- стоимость;
- номенклатура;
- фото;
- связанные действия.

---

## 9. Employees / HR

Employee — отдельная сущность.

Минимальные поля сотрудника для MVP:

- ФИО;
- пожелания по выходам;
- ставка;
- телефон;
- место проживания;
- список объектов, на которых работал.

Подмена — отдельный сценарий HR-контура.
Approval для подмены в MVP допустим как отдельное sensitive action, если подмена затрагивает утвержденный график, табель или критичный объект.

Правила доступа к employee registry и employee card:

- leadership circle и `hr` могут просматривать и вести HR-контур;
- `deputy_director` получает просмотр employee registry и employee card без права создавать, редактировать, архивировать или назначать сотрудников;
- этот просмотр не расширяет object visibility автоматически.

---

## 10. Подотчет и расходы

### 10.1. Кто может выдавать подотчет

По умолчанию подотчет выдают:

- `founder`
- `director`

Дополнительно это право может быть выдано через capability представителю leadership circle.

### 10.2. Передача подотчета

Подотчет нельзя передавать другому человеку.
Его можно только вернуть тому, кто выдал.

### 10.2.a. Обычная сверка подотчета

Обычная approved closure не закрывает живой account terminally.

После подтвержденной сверки:

- вошедшие в сверку `approved` расходы становятся `reconciled`;
- account возвращается в `active`;
- пользователь снова может заносить новые расходы;
- в тот же account снова можно выдавать funding.

`closed` остается только для редких terminal/admin случаев.

### 10.3. MVP expense input

В первой версии enum типов расходов не требуется.

Минимальный contract расхода:

- сумма;
- текстовое описание;
- опциональные фото / файл через platform attachments.

---

## 11. Комментарии и чаты

### 11.1. Комментарии внутри объекта

Комментарий внутри объекта — это не чат.

### 11.2. Чаты MVP

Чаты — отдельный модуль первой версии.

Минимальный baseline:

- общий чат;
- чат регулярных объектов;
- чат разовых заказов;
- чат подмен.

---

## 12. Capability catalog

Минимальный capability catalog для Sprint 2 и следующих implementation-этапов:

- `timesheet.manual_correction`
- `object.budget_edit`
- `object.daily_rate_edit`
- `accountability.issue_cash`
- `expense.approve`
- `approval.resolve_task_result`
- `approval.resolve_object_change`
- `approval.resolve_inventory_exception`

Этот список является минимальным каноническим каталогом на текущем этапе.

---

## 13. Minimal approval catalog

Минимальные approval types:

- `task_result_confirmation`
- `object_change_confirmation`
- `inventory_exception_confirmation`
- `inventory_return_confirmation`
- `inventory_writeoff_confirmation`
- `equipment_return_confirmation`
- `equipment_writeoff_confirmation`
- `accountability_closure_confirmation`
- `manual_timesheet_exception_confirmation`

---

## 14. Module boundary mapping for approvals

| Approval type                           | Created by module       | Source entity                   | Who resolves                           | Required capability                  |
| --------------------------------------- | ----------------------- | ------------------------------- | -------------------------------------- | ------------------------------------ |
| task_result_confirmation                | tasks                   | task result                     | leadership / designated approver       | approval.resolve_task_result         |
| object_change_confirmation              | objects                 | object change                   | leadership                             | approval.resolve_object_change       |
| inventory_exception_confirmation        | inventory               | inventory exception             | director / designated approver         | approval.resolve_inventory_exception |
| inventory_return_confirmation           | inventory               | inventory return                | leadership / designated approver       | approval.resolve_inventory_exception |
| inventory_writeoff_confirmation         | inventory               | inventory writeoff              | leadership / designated approver       | approval.resolve_inventory_exception |
| equipment_return_confirmation           | equipment               | equipment return                | leadership / designated approver       | approval.resolve_object_change       |
| equipment_writeoff_confirmation         | equipment               | equipment writeoff              | leadership / designated approver       | approval.resolve_object_change       |
| accountability_closure_confirmation     | expenses-accountability | accountability closure          | leadership / designated approver       | expense.approve                      |
| manual_timesheet_exception_confirmation | timesheets              | exceptional correction flow     | leadership / designated approver       | timesheet.manual_correction          |

---

## 15. Transitional rule for runtime

Shared `ApprovalsModule` является owner approval-контура там, где runtime migration уже встроен.

На текущем MVP-слое в shared runtime уже переведены:

- `task_result_confirmation`
- `inventory_exception_confirmation`
- `accountability_closure_confirmation`

Для остальных approval types transitional bridge-state в доменных модулях еще допустим, но он не считается owner shared approval semantics.

---

## 16. Sprint 1 closeout rule

Sprint 1 считается полностью закрытым только если:

1. docs не содержат старых leadership-списков с `deputy_director`;
2. runtime не дает `Responsible` object core edit по умолчанию;
3. runtime не дает manual timesheet correction через обычный timesheet access.

До этого момента любые расхождения считаются runtime drift, а не новой нормой.

---

## 17. Platform files baseline

До появления domain-specific attachment contracts действует минимальный platform-safe baseline:

- `FileAttachment.entityType` допускает только:
  - `object`
  - `object_arrival_photo`
  - `object_daily_report`
  - `object_comment`
  - `task`
- свободные `entityType` не допускаются;
- `fieldCode` на этом этапе не вводит отдельные domain-поля и должен оставаться `null`, пока конкретный модуль не добавит свой явный contract;
- доступ к файлу отдается через backend-authenticated download proxy, а не через прямой публичный storage URL;
- расширение списка `entityType` и появление канонических `fieldCode` выполняется только вместе с контрактом соответствующего модуля.

---

## 18. Candidates and notification foundation

- `Candidate` отделён от `Employee` и `User`; автоматическая конвертация в employee отсутствует.
- назначение менеджера исторично, один active assignment запускает SLA ответа 2 часа;
- первый ответ текущего менеджера закрывает SLA, чужой ответ сохраняется без закрытия;
- просрочка создаёт одно персональное notification назначенному менеджеру;
- generic Notification foundation владеет хранением, dedupe и read-state, но не бизнес-состоянием кандидата.
