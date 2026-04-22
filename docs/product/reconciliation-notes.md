# Reconciliation Notes

## Что было выровнено

### Роли

- commercial_director убран как отдельное имя;
- используем corporate_director;
- руководящий круг теперь фиксирован.

### Финансовый доступ

- wide operational access отделен от права менять бюджет и ставку.

### Объекты

- responsible и manager окончательно разведены;
- создатель объекта автоматически responsible;
- бюджет объекта в MVP — общая сумма с расшифровкой;
- задолженность — отдельная сущность.

### Табель

- core первой версии строится вокруг daily rate;
- ручная корректировка табеля требует отдельного права;
- отдельный UI-журнал ставок не нужен, audit trail достаточно.

### Разовые заказы

- статус “ожидает оплаты” исключен;
- табель по заказу — отдельный контур.

### Inventory

- если заказ привязан к объекту, его расходные операции отображаются в объекте блоком “Из разового заказа”;
- фото складских операций сохраняются.
- runtime bridge Sprint 6:
  - leadership circle получает полный inventory access;
  - `deputy_director` получает operational inventory access без catalog admin / writeoff / adjustment;
  - `adjustment` моделируется явным `adjustmentDirection`;
  - `receipt` обновляет текущую цену номенклатуры, а каждое движение хранит snapshot цены и суммы;
  - назначенный manager объекта может делать object-scoped `issue_to_object` без доступа к полному inventory admin;
  - `issue_to_object` без фото уходит в director-only approval bridge;
  - другие движения с обязательным фото получают typed missing-evidence state без director-only resolution;
  - evidence/фото движения живут в files/storage baseline как `inventory_movement` attachments.

## Sprint 7 Equipment closeout contract

- equipment отделен от inventory: штучный жизненный цикл вместо количественного ledger;
- `EquipmentUnit` хранит текущий статус и текущую object/order привязку;
- `EquipmentMovement` хранит историю выдач, возвратов, ремонта, поломок, утерь и списаний;
- `equipment_movement` добавлен как канонический `FileAttachment.entityType`;
- object/order карточки получают scoped equipment blocks без автоматического global equipment access;
- `deputy_director` получает operational equipment access, но не catalog admin и не writeoff.

### HR и expenses

- employee fields зафиксированы;
- до появления более детализированной HR visibility model employee registry и employee card доступны leadership circle и `hr`, без автоматического расширения object visibility;
- availability в runtime bridge моделируется явным режимом `full_day` или `timed`;
- substitution в object/runtime слое отображается поверх staffing и не переписывает основной состав объекта;
- подотчет по умолчанию выдают founder/director;
- передавать подотчет другому нельзя.

### Communication

- внутри объекта — comments, не чат;
- MVP-чаты зафиксированы: общий, регулярные объекты, разовые, подмены.

### Approvals

- подтверждение нужно для создания объекта, закрытия задачи, изменения объекта и assignments.

# Runtime vs Contract Reconciliation Notes

## 1. Object edit right for Responsible

Contract rule:

- responsible does not edit object core card by default.

Current runtime note:

- if backend currently allows assigned responsible to edit object card, this is treated as temporary runtime drift, not as the new product rule.

Action:

- fix backend policy in implementation backlog.

## 2. Manual timesheet correction

Contract rule:

- manual timesheet correction is not granted by wide visibility alone;
- by default it belongs only to founder and director;
- other roles require dedicated capability: timesheet.manual_correction.

Current runtime note:

- any broader runtime behavior must be treated as temporary implementation drift.

## 3. Approval layer

Contract rule:

- approval is a shared future module;
- approval types and approval actors are fixed already at contract level;
- runtime absence of the module does not отменяет contractual approval boundaries.

## 4. Role vocabulary

Contract rule:

- system roles, object assignments, order assignments, visibility and capabilities are separate layers.
- one_time_manager is not a system role.
- responsible and object manager are not system roles.

---

# Sprint 1 Closeout Reconciliation Summary

## Назначение секции

Эта секция кратко фиксирует, какие противоречия были закрыты в Sprint 1 closeout, какие еще считаются runtime drift, и на что должен опираться следующий implementation-спринт.

---

## 1. Что считается закрытым на уровне документов

### 1.1. Leadership circle

Канонический состав leadership circle зафиксирован как:

- `founder`
- `deputy_founder`
- `director`
- `corporate_director`

`deputy_director` не входит в leadership circle по умолчанию.

### 1.2. Role vs assignment model

Зафиксировано различие между:

- system role;
- object assignment;
- one-time order assignment.

### 1.3. Timesheet semantics

Зафиксировано различие между:

- access to timesheet;
- manual timesheet correction.

### 1.4. Capability catalog

Минимальный набор capability codes зафиксирован именованно и считается обязательным для следующего этапа.

### 1.5. Minimal approval catalog

Минимальный набор approval types зафиксирован как продуктовая опора для следующего implementation-спринта.

### 1.6. Module boundary mapping

Появился явный bridge между contract domains и planned backend modules.

---

## 2. Что еще считается runtime drift

### 2.1. Responsible -> object core edit

Если текущий runtime где-то разрешает assigned `Responsible` редактировать object core, это считается drift.

Контрактный источник истины:

- `product-contract.md`
- `access-matrix.md`

### 2.2. Manual timesheet correction

Если текущий runtime still allows manual monetary correction based only on generic timesheet access, это считается drift.

Контрактный источник истины:

- manual correction по умолчанию только `founder` и `director`;
- остальные только через `timesheet.manual_correction`.

### 2.3. Approval ownership

Если runtime-модуль сам трактует свой статус `awaiting_confirmation` как полноценный universal approval workflow, это считается drift.

Контрактный источник истины:

- shared approval semantics принадлежат отдельному `approvals` module.

---

## 3. Как трактовать подобные расхождения дальше

Если между:

- docs,
- текущим runtime,
- промежуточной перепиской,
- локальными helper-реализациями

возникает конфликт, то приоритет такой:

1. `product-contract.md`
2. `access-matrix.md`
3. `glossary.md`
4. `open-questions-register.md`
5. текущий runtime
6. локальные implementation-компромиссы

То есть:

- runtime не переписывает контракт сам по себе;
- временно работающий код не считается автоматически принятым бизнес-правилом;
- следующий implementation-спринт должен исправлять drift к контракту, а не наоборот.

---

## 4. Что должен брать как вход следующий implementation-спринт

Следующий implementation-спринт должен считать входными и уже согласованными следующие вещи:

- канонический leadership circle;
- разделение role / object assignment / order assignment;
- separation between timesheet access and manual correction;
- minimal capability catalog;
- minimal approval catalog;
- module boundary mapping.

Следующий спринт не должен заново спорить об этих правилах, а должен использовать их как исходный контракт.

---

## 5. Sprint 1 closeout status

Статус Sprint 1 closeout:

- docs alignment: completed with explicit closeout notes
- runtime alignment: partially pending
- ready for next implementation sprint: yes, if runtime drift items are tracked explicitly and fixed deliberately

### Runtime drift items to track immediately

1. `Responsible` object core edit
2. `Timesheet` manual correction enforcement
3. approval ownership boundaries in runtime modules

Эти три пункта не блокируют завершение документарного Sprint 1, но должны быть явно поставлены в начало следующего implementation backlog.
