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
  - `deputy_director` получает operational inventory access, включая catalog admin / writeoff / adjustment;
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
- `deputy_director` получает operational equipment access, включая catalog admin и writeoff.

### HR и expenses

- employee fields зафиксированы;
- employee registry и employee card доступны leadership circle и `hr` для просмотра и управления;
- `deputy_director` получает view-only доступ к employee registry и employee card без автоматического расширения object visibility;
- availability в runtime bridge моделируется явным режимом `full_day` или `timed`;
- substitution в object/runtime слое отображается поверх staffing и не переписывает основной состав объекта;
- подотчет по умолчанию выдают founder/director;
- передавать подотчет другому нельзя.
- в MVP расходы подотчета не требуют enum типов и заводятся свободным текстом;
- closure делается через живой account + ledger + reconciliation attempt history.
- approved closure возвращает обычный account в `active`, а не в terminal `closed`.

### Communication

- внутри объекта — comments, не чат;
- MVP-чаты зафиксированы: общий, регулярные объекты, разовые, подмены.
- `deputy_director` может создавать и администрировать рабочие/custom-чаты, не становясь участником leadership circle.

### Deputy director operational access correction

- `deputy_director` получает широкий operational просмотр objects и one-time-orders;
- `deputy_director` получает широкий task access для создания и назначения задач вне собственного object-manager scope;
- это не расширяет HR, accountability cash issuance, manual timesheet correction, object daily rate edit и leadership-only visibility.

### Approvals

- подтверждение нужно для создания объекта, закрытия задачи, изменения объекта и assignments.
- runtime Wave 2 перевел в shared approvals следующие sensitive actions:
  - `manual_timesheet_exception_confirmation` через отдельную `timesheet_manual_exception` сущность;
  - `object_change_confirmation` в первом проходе ограничен object status change path;
  - `inventory_writeoff_confirmation`;
  - `equipment_writeoff_confirmation`.

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
- для migrated MVP flows shared runtime owner уже существует:
  - `task_result_confirmation`
  - `inventory_exception_confirmation`
  - `accountability_closure_confirmation`

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

---

## Product decisions reconciliation — 2026-10-07 (с уточнением 2026-10-08)

The following customer decisions supersede conflicting earlier roadmap drafts and must be applied during implementation. This records the contract decision only; runtime conformance remains unverified until the relevant implementation stage and tests complete.

| Area                            | Reconciled decision                                                                                                                                                                                                                                                                                                                          | Runtime verification required                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| User calendar                   | Separate all-User calendar; preserve the existing one-time-order calendar. Only Kireeva gets personal all-user view/edit including absence reasons; every other User can work only with their own user calendar. No role-wide grant is allowed. | Authorization tests on list/detail/mutation endpoints, including forged `managerUserId`.                               |
| Object materials                | Create object first, attach files in a dedicated materials section; permanent checklist/instructions are distinct from daily attendance.                                                                                                                                                                                                     | Create-first flow, authorized downloads, responsive collapsed/expanded long text, no lost object on upload failure.    |
| Counterparty master object      | One hub per counterparty; aggregates linked objects and where inventory was consumed. Not a warehouse and does not change issue target.                                                                                                                                                                                                      | Uniqueness, linking, aggregation scope and regression that movement remains on the physical object.                    |
| One-time staff                  | Assigned cleaners remain Employees; track planned/actual attendance, gaps, correction actor/time/reason, completion confirmation and filtered export.                                                                                                                                                                                        | Access, audit, backdated correction and export tests.                                                                  |
| External accountability receipt | Any active User may post an unlimited, immediate external receipt to their own account with mandatory source text/comment and optional file. It enters official balance and later reconciliation. Preserve existing user-to-user funding; company advance remains permission-gated; order payment cannot be duplicated.                      | Ledger/balance invariants, authorization, idempotency/source separation, reversal and reconciliation tests.            |
| Seasonal service                | Separate editable summer/winter profiles; summer window-washing and engineering flags; winter tractor enum. No implicit change to numeric calculation.                                                                                                                                                                                       | Existing object edit, save/load, migration defaults and historical calculation regression.                             |
| Rubber carpets                  | Track as reusable object assets (not consumable stock), with zone/size/condition/service history; supplies consumed for service remain ordinary inventory movements to actual object.                                                                                                                                                        | Asset lifecycle, history, scoped access, and inventory linkage tests.                                                  |
| Object substitution             | Time-bounded, explicit object scope; act as self; effective access is own permissions UNION source user's object permissions, never intersection; no automatic global sensitive rights; audit both actors.                                                                                                                                   | Positive/negative cross-scope authorization and expiration/revocation tests.                                           |
| Order review                    | Anyone who can access the order can add/update its text review; this does not grant finance visibility.                                                                                                                                                                                                                                      | Policy and API tests across order roles.                                                                               |
| Timesheet and rates             | Manual rates for complex shifts/extra work; salary attendance feeds the daily timesheet fact once; manager display in export is current assignment; summary spreadsheet layout waits for customer sample.                                                                                                                                    | No duplicate days, historical values not silently recalculated, current manager selection and permission-safe exports. |

This reconciliation is the product contract. It does not claim that any item is already implemented or correct in runtime.

## Runtime verification evidence — 2026-10-08

The following contract areas now have passing isolated integration coverage in the current checkout; this closes the earlier “unverified” statement for API/data/security behavior, but does not certify every responsive layout or replace production rollout checks:

| Contract area | Runtime evidence |
| --- | --- |
| User calendar | `user-absences.integration.test.ts`: self scope, Kireeva full access including private reasons, create/edit/delete and audit; other tested roles denied foreign-user access. |
| Object materials and seasonal service | `object-media.integration.test.ts`, `object-access.integration.test.ts`, and object create/edit coverage: scoped attachment access, canonical seasonal values and preserved object access boundaries. |
| Counterparty master object | `counterparties.integration.test.ts`: one-master constraints, assignment/removal, object transfer/unlink, audit and inventory movement anchored to physical object. |
| External accountability receipt | Accountability integration suite: immediate ledger/balance, source/comment/file rules, reversal, reconciliation and regressions for user-to-user funding and order receipts. |
| One-time staff and reviews | `one-time-order-workforce-attendance.integration.test.ts`, `one-time-order-review.integration.test.ts`, `one-time-order-reviews.integration.test.ts`: assignment scope, attendance gaps/correction audit/export, review-only permissions and independent finance access. |
| Rubber carpets | `rubber-mats.integration.test.ts`: object scope, reusable asset movement/service history, with no substitution for consumable inventory movements. |
| Object substitution | `user-substitutions.integration.test.ts`: own-rights union, explicit object scope, identity preservation, expiry/revocation and no inheritance of global sensitive permissions. |
| Rates and timesheet | `object-attendance-timesheet.integration.test.ts`, `timesheet-overview.integration.test.ts`, `timesheet-rate-policy-export.integration.test.ts`, and `timesheet-permissions.integration.test.ts`: idempotent salary sync, manual rates, immutable history, current manager in export and separate correction capability. |

Full suite result: 90 tests passed across 68 isolated database schemas. A fresh `pnpm ci:check` also passed: Prisma Client generation, lint, backend/frontend/shared typecheck, and backend/frontend builds. Desktop browser checks covered object registry/card, calendar grid and carpet section. Follow-up Chrome checks verified the one-time-order create form at 400 px and 1024 px: fields and CTA use the CRM theme, the date-mode choices wrap without clipping; the accountability file control was also checked at a narrow viewport. These checks do not close Stage 19. After production build refreshed the shared `.next` output, the dev server was restarted; the default watcher hit `EMFILE`, while `WATCHPACK_POLLING=true` allowed startup. The subsequent Chrome check was interrupted because macOS was locked, and its prior console showed an auth request to `localhost:4000` while the local backend was running at `3101`. Resume after unlocking the Mac, override the API URL for the local preview process (do not edit shared environment files without need), and verify the remaining responsive golden paths. No production CRM data or the main dev schema was changed. Stage 19 remains open.
