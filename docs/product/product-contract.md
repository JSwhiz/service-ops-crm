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

### 8.2. Оборудование

Оборудование — отдельный контур, не смешивается с расходниками.

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

### 10.3. Минимальные типы расходов MVP

- зарплата
- бензин
- ремонт техники
- подотчет
- расходники
- прочее

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
- `object_assignment_change_confirmation`
- `inventory_without_photo_confirmation`
- `expense_confirmation`
- `manual_timesheet_exception_confirmation`

---

## 14. Module boundary mapping for approvals

| Approval type                           | Created by module       | Source entity                   | Who resolves                           | Required capability                  |
| --------------------------------------- | ----------------------- | ------------------------------- | -------------------------------------- | ------------------------------------ |
| task_result_confirmation                | tasks                   | task result                     | leadership / designated approver       | approval.resolve_task_result         |
| object_change_confirmation              | objects                 | object change                   | leadership                             | approval.resolve_object_change       |
| object_assignment_change_confirmation   | objects                 | object assignment change        | leadership                             | approval.resolve_object_change       |
| inventory_without_photo_confirmation    | inventory               | inventory operation             | deputy_director or designated approver | approval.resolve_inventory_exception |
| expense_confirmation                    | expenses-accountability | expense / accountability action | leadership / designated approver       | expense.approve                      |
| manual_timesheet_exception_confirmation | timesheets              | exceptional correction flow     | leadership / designated approver       | timesheet.manual_correction          |

---

## 15. Transitional rule for runtime

На текущем этапе shared `ApprovalsModule` может еще отсутствовать в runtime.

Переходное правило:

- отдельные модули могут иметь промежуточные статусы типа `awaiting_confirmation`;
- это не означает, что они являются владельцами будущего shared approval workflow;
- каноническим owner approval-контура будет отдельный shared module.

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
