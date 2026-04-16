# Glossary

## Назначение документа

Этот глоссарий фиксирует канонические термины проекта.
Если в старом коде, заметках или черновых документах термин использован иначе, источником истины считается этот документ.

---

## 1. User

Системный пользователь, который входит в систему, имеет auth и system role.

`User` не равен `Employee`.

---

## 2. Employee

Сотрудник операционного контура.

Employee используется в staffing, attendance, timesheet, HR и related domains.

---

## 3. System role

Глобальная системная роль пользователя.

Примеры:

- founder
- deputy_founder
- director
- corporate_director
- deputy_director
- manager
- senior_manager
- operation_manager
- hr
- sys_admin

---

## 4. Leadership circle

Leadership circle — верхний управленческий слой системы.

Канонический состав:

- `founder`
- `deputy_founder`
- `director`
- `corporate_director`

`deputy_director` не входит в leadership circle по умолчанию.

---

## 5. Object assignment

Назначение пользователя на конкретный объект.

Канонические object assignments:

- `responsible`
- `manager`

Это не system roles.

---

## 6. Order assignment

Назначение пользователя на конкретный разовый заказ.

Канонический order assignment:

- `one_time_manager`

Это не system role.

---

## 7. Responsible

Responsible — управленческое назначение на объект.

Responsible:

- участвует в управлении объектом в рамках object scope;
- не становится частью leadership circle автоматически;
- не получает object core edit по умолчанию.

---

## 8. Object manager

Manager объекта — операционное назначение на объект.

Manager:

- ведет операционный контур объекта;
- работает со staffing / attendance / report flow;
- не получает object core edit по умолчанию.

---

## 9. Staffing

Текущий состав сотрудников объекта.

Это не attendance и не timesheet.

---

## 10. Attendance

Факт присутствия сотрудника в конкретную дату.

Это не staffing и не timesheet.

---

## 11. Timesheet

Учетный слой, который фиксирует результат по дням и периодам.

Timesheet использует attendance как источник факта, но не равен attendance.

---

## 12. Manual timesheet correction

Ручная корректировка ячейки табеля.

Каноническое правило:

- это отдельное чувствительное действие;
- оно не равно общему доступу к табелю;
- по умолчанию разрешено только founder/director;
- для остальных возможно только через capability `timesheet.manual_correction`.

---

## 13. Capability

Capability — адресное право на чувствительное действие, не тождественное system role и не тождественное assignment.

Примеры:

- `timesheet.manual_correction`
- `object.budget_edit`
- `object.daily_rate_edit`
- `accountability.issue_cash`
- `approval.resolve_task_result`
- `approval.resolve_object_change`
- `approval.resolve_inventory_exception`

---

## 14. Approval

Отдельный универсальный контур подтверждений.

Approval не должен быть размазан по доменным модулям как произвольный if/else.

---

## 15. Object comment

Комментарий внутри объекта.

Это не чат.

---

## 16. Chat

Отдельный модуль коммуникации.

Комментарии внутри объекта и карточки сущностей не считаются chat-модулем.

---

## 17. Budget

Управленческая финансовая рамка объекта.

По умолчанию редактируется только founder/director, если иное не выдано capability-моделью.

---

## 18. Daily rate

Базовая ставка дня, используемая системой как автоматическая база для табеля.

---

## 19. Runtime drift

Runtime drift — это расхождение между уже зафиксированным контрактом docs и текущим поведением кода.

Такие расхождения не считаются новой нормой и подлежат исправлению.

---

## 20. Sprint 1 closeout

Состояние, при котором:

- leadership circle канонизирован;
- role vocabulary согласован;
- object core edit rule зафиксирован;
- timesheet manual correction rule зафиксирован;
- capability catalog и minimal approval catalog зафиксированы.

До runtime alignment closeout по docs может быть завершен частично, но Sprint 1 как целое — нет.
