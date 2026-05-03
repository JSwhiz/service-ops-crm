# Access Matrix

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
| View object core       | yes     | yes            | yes      | yes                | optional operationally | yes                                                            | yes     |
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

## 5. Budget / daily rate / finance

| Action                 | founder | deputy_founder                    | director | corporate_director                | deputy_director      |
| ---------------------- | ------- | --------------------------------- | -------- | --------------------------------- | -------------------- |
| View financial block   | yes     | optional by visibility/capability | yes      | optional by visibility/capability | view only if granted |
| Edit object budget     | yes     | no by default                     | yes      | no by default                     | no                   |
| Edit object daily rate | yes     | no                                | yes      | no                                | no                   |

Дополнительные финансовые действия могут выдаваться capability-моделью.

---

## 6. Timesheet access matrix

### 6.1. Base timesheet access

| Action                                       | leadership circle | deputy_director              | responsible | manager |
| -------------------------------------------- | ----------------- | ---------------------------- | ----------- | ------- |
| View timesheet                               | yes               | yes if allowed operationally | yes         | yes     |
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

---

## 8. Inventory exception rule

### 8.1. Inventory runtime bridge for Sprint 6

| Action                         | leadership circle | deputy_director | manager | one_time_manager | hr |
| ------------------------------ | ----------------- | --------------- | ------- | ---------------- | -- |
| View inventory module          | yes               | yes             | no      | no               | no |
| Manage inventory catalog       | yes               | no              | no      | no               | no |
| Create receipt / issue / return| yes               | yes             | no      | no               | no |
| Object-scoped issue_to_object  | yes               | yes             | yes if assigned to object | no | no |
| Create writeoff                | yes               | no              | no      | no               | no |
| Create adjustment              | yes               | no              | no      | no               | no |
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
| Manage equipment catalog           | yes               | no              | no      | no               | no |
| Assign equipment to object         | yes               | yes             | no      | no               | no |
| Assign equipment to one-time order | yes               | yes             | no      | no               | no |
| Return / move equipment            | yes               | yes             | no      | no               | no |
| Mark broken / send to repair       | yes               | yes             | no      | no               | no |
| Writeoff equipment                 | yes               | no              | no      | no               | no |
| View object-scoped equipment       | yes               | yes             | yes if assigned to object | no | no |
| View order-scoped equipment        | yes               | yes             | no      | yes if assigned to order | no |

Переходное правило:

- object/order scoped equipment blocks показывают reference без доступа к глобальной equipment card;
- object или one-time-order linkage не расширяет global equipment module access.

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
