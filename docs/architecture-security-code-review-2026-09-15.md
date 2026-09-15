# Service Ops CRM — Architecture, Code & Security Review

**Дата:** 2026-09-15  
**Репозиторий:** `JSwhiz/service-ops-crm`  
**Ветка:** `dev`  
**HEAD на момент ревью:** `feb39af7489f3f82c5d3b92a35c62b6467ea7b3a`  
**Статус документа:** зафиксированный review / backlog hardening  
**Важно:** данный документ не блокирует текущую продуктовую разработку. Hardening-пакет планируется выполнить отдельным этапом после завершения согласованных продуктовых волн.

---

## 1. Цель ревью

Провести оценочную проверку текущего состояния проекта по следующим направлениям:

- продуктовая и доменная архитектура;
- backend architecture;
- frontend architecture;
- Prisma / data model;
- ACL / authorization;
- authentication / sessions;
- files / object storage;
- production / Docker / reverse proxy;
- security hardening;
- тестовая стратегия;
- observability;
- backup / restore;
- технический долг;
- риск дальнейшего product/business-logic drift.

Во время ревью код не изменялся. GitHub Actions / CI не запускались.

---

## 2. Итоговая оценка

| Область | Оценка | Комментарий |
| --- | ---: | --- |
| Продуктовая / доменная архитектура | **8.5/10** | Домены в целом разделены правильно |
| Backend architecture | **7/10** | Хороший modular monolith, но крупные сервисы перегружены |
| Data model / Prisma | **8/10** | Богатая модель и хорошие связи, есть места для hardening |
| ACL / authorization | **8/10** | Сильнее среднего, но есть риск drift между policy-функциями |
| Frontend architecture | **7/10** | Системный UI, но отдельные workspace/page уже слишком крупные |
| Тестирование | **8/10** | Сильное backend integration coverage |
| Production / DevOps | **7/10** | Адекватный deployment, но не хватает operational hardening |
| Security | **6.5/10** | Фундамент хороший, есть несколько серьёзных P1 |
| **Итого** | **≈7.7/10** | Хороший production CRM, которому нужен hardening, а не переписывание |

### Главный вывод

Проект **не требует переписывания** и **не требует перехода на микросервисы**.

Текущий формат **NestJS modular monolith + Next.js + PostgreSQL + Redis + MinIO** подходит проекту.

Основная задача на следующем техническом этапе:

> сохранить предсказуемость бизнес-логики, ACL и данных при дальнейшем росте функциональности.

---

# 3. Сильные стороны

## 3.1. Хорошая доменная декомпозиция

Ключевые сущности не смешиваются:

```text
User != Employee
Employee != Candidate
Object != Counterparty
Inventory != Equipment
Comment != DailyReport
Role != Assignment
```

Backend уже разделён на самостоятельные домены:

- objects;
- object-operations;
- one-time-orders;
- timesheets;
- employees;
- candidates;
- counterparties;
- inventory;
- equipment;
- accountability;
- tasks;
- approvals;
- chats;
- user-absences;
- files;
- audit;
- search.

Это хорошая база для дальнейшего развития без микросервисной сложности.

---

## 3.2. Access model

Фактическая модель доступа развивается в правильном направлении:

```text
Role
+ Permission / Capability
+ Entity Scope
+ Assignment
+ конкретный access predicate
```

Это важно, потому что:

- глобальная роль `manager` не равна назначению manager на конкретный объект;
- `one_time_manager` — assignment на конкретный заказ;
- frontend capability используется для UX;
- backend остаётся authoritative по ACL.

---

## 3.3. Authentication foundation

Сильные стороны текущего auth:

- access JWT;
- refresh sessions;
- refresh rotation;
- refresh token не хранится открытым в БД;
- token hash строится через HMAC;
- password хранится через `scrypt + random salt`;
- password verification использует `timingSafeEqual`;
- access-token validation повторно загружает пользователя из БД;
- отключённый / удалённый пользователь не продолжает работать только на основании старого JWT;
- HttpOnly cookies;
- Secure cookie в production;
- SameSite;
- глобальный DTO whitelist;
- `forbidNonWhitelisted: true`.

---

## 3.4. Files ACL

Файловый контур в целом спроектирован правильно:

```text
file
→ attachment
→ entity
→ entity ACL
```

То есть знания одного `fileId` недостаточно для скачивания файла.

Также есть полезные защитные меры:

- размер upload ограничен;
- private cache headers;
- `X-Content-Type-Options: nosniff`;
- sandbox CSP для preview;
- attachment entity type validation.

---

## 3.5. Финансовая и историческая модель

Хорошими решениями являются:

- snapshot денежных значений;
- financial history;
- payment corrections;
- reversals;
- workCycle;
- idempotency / clientRequestId в чувствительных цепочках;
- audit/history entities;
- soft deletion;
- unique constraints;
- индексы на основные operational query paths.

---

## 3.6. Тестирование

Сильная сторона проекта — большое количество integration tests.

Покрываются, в частности:

- auth;
- object access;
- task access;
- timesheet permissions;
- one-time-order capabilities;
- one-time-order completion;
- payments;
- payment corrections;
- reviews;
- calendar;
- concurrency;
- inventory;
- equipment;
- employees;
- candidates;
- counterparties;
- file access;
- financial history persistence;
- idempotency-sensitive сценарии.

Это существенно снижает риск backend regression.

---

# 4. Архитектурный долг

## 4.1. Очень крупные domain services

На момент ревью:

```text
one-time-orders.service.ts     ~4295 строк
timesheets.service.ts          ~2266 строк
objects.service.ts             ~1548 строк
files.service.ts               ~1490 строк
candidates.service.ts           ~577 строк
```

Frontend:

```text
one-time-orders/[id]/page.tsx   ~729 строк
candidates/[id]/page.tsx        ~537 строк
```

### Риск

Крупный service начинает одновременно отвечать за:

- registry;
- lifecycle;
- ACL;
- financial logic;
- reviews;
- completion;
- managers;
- transitions;
- history.

Это повышает вероятность случайной регрессии.

### Рекомендация

Не делать глобальный rewrite.

При следующих изменениях постепенно выделять внутренние domain services, например:

```text
OneTimeOrderRegistryService
OneTimeOrderLifecycleService
OneTimeOrderReviewService
OneTimeOrderPaymentService
OneTimeOrderManagerService
OneTimeOrderAccessPolicy
```

Все они остаются внутри одного Nest module.

**Приоритет:** P1 technical debt.

---

# 5. Documentation drift

В проекте есть хорошие canonical docs:

- `AGENTS.md`;
- `product-contract.md`;
- `access-matrix.md`;
- `glossary.md`;
- `open-questions-register.md`;
- `reconciliation-notes.md`;
- `golden-path-index.md`;
- ADR.

Но часть старых документов уже отстаёт от runtime.

Примеры:

- устаревшие role names;
- старое описание стадии проекта как foundation;
- отдельные access-модели не полностью совпадают с текущей canonical matrix.

### Риск

Новый разработчик может реализовать корректно относительно старого документа, но неправильно относительно текущего продукта.

### Рекомендация

В hardening sprint:

1. выбрать один canonical access/domain contract;
2. пометить obsolete документы;
3. reconciliation сделать явным;
4. добавить дату / status на важные docs.

**Приоритет:** P2.

---

# 6. ACL drift risk

ACL уже распределён по нескольким доменам:

- objects;
- tasks;
- one-time-orders;
- files;
- inventory;
- equipment;
- candidates;
- counterparties;
- search.

Это нормально, но повышает риск, что одно бизнес-правило будет описано чуть по-разному в разных местах.

Исторические примеры подобных drift-кейсов:

- пользователь видел order, но не связанную task;
- scoped inventory был ограничен global inventory permission;
- search мог раскрыть связанную сущность шире основной карточки.

### Рекомендация

Внутри каждого домена иметь authoritative policy entry points:

```text
canReadObject(...)
canOperateObject(...)

canReadOrder(...)
canEditOrder(...)

canReadTask(...)
```

Другие модули должны переиспользовать policy, а не заново собирать похожее условие.

Не нужен один глобальный God ACL Service.

**Приоритет:** P1.

---

# 7. Security findings

## 7.1. P0

На момент статического ревью **явный P0 не обнаружен**.

Не найдено очевидного:

- unauthenticated RCE;
- raw SQL injection path;
- массового публичного ACL bypass;
- опасного `eval`;
- `dangerouslySetInnerHTML` в проверенной выборке;
- прямого публичного доступа к MinIO/PostgreSQL.

Это не означает формальную гарантию отсутствия уязвимостей; это результат текущего статического review.

---

## 7.2. P1 — auth rate limiting / proxy IP

Текущий auth limiter хранит попытки в process memory:

```text
Map<route + IP, timestamps>
```

Ограничения:

```text
/login   5 / minute
/refresh 15 / minute
```

Backend работает за Caddy.

При этом trust proxy должен быть настроен и проверен отдельно. Иначе `request.ip` может определяться как адрес reverse proxy, а не клиента.

### Возможный эффект

Небольшое число плохих login attempts потенциально способно ограничить login для всех пользователей одного proxy IP.

### Исправление

- корректный trusted proxy;
- Redis-backed limiter;
- IP limit;
- login/account limit;
- очистка / TTL на уровне Redis;
- отдельные thresholds для login и refresh.

Redis уже есть в инфраструктуре.

**Приоритет:** P1.

---

## 7.3. P1/P2 — refresh token family / revoke-all

Refresh rotation реализована хорошо.

Но нужен дополнительный hardening:

- session family;
- refresh-token reuse detection;
- revoke entire family при reuse;
- `revokeAllSessionsForUser()`;
- принудительный revoke при:
  - password reset;
  - account disable;
  - security logout everywhere;
  - критическом изменении прав.

**Приоритет:** P1/P2.

---

## 7.4. P1 — PostgreSQL least privilege

В production-конфигурации application DB user совпадает с `POSTGRES_USER`.

Для official PostgreSQL container такой пользователь создаётся с очень широкими правами.

### Риск

При backend compromise blast radius слишком большой.

### Целевая схема

```text
service_ops_owner
    schema / migrations

service_ops_app
    SELECT
    INSERT
    UPDATE
    DELETE
    sequence usage
```

Backend работает как `service_ops_app`.

Migration container использует owner credentials.

**Приоритет:** P1.

---

## 7.5. P1 — MinIO least privilege

Application credentials и MinIO root credentials не должны совпадать.

### Целевая схема

```text
MinIO root
    administration only

service-ops-backend
    access only to service-ops-files bucket
    required object operations only
```

Backend не должен иметь arbitrary bucket admin rights.

В production bucket лучше создавать deploy/init процессом, а не приложением.

**Приоритет:** P1.

---

## 7.6. P1 — production seed guard

`prisma/seed.ts` содержит fixture users и предсказуемые development passwords.

Пароли хешируются перед записью, но опасность состоит в другом:

> случайный seed в production может создать / обновить известные учетные данные.

### Исправление

Seed должен hard-fail:

```ts
if (APP_ENV === 'production') {
  throw new Error('Seed is forbidden in production');
}
```

Production deployment должен использовать только:

```text
prisma migrate deploy
```

а не seed.

**Приоритет:** P1.

---

## 7.7. P1/P2 — HTTP security headers

Caddy сейчас обеспечивает:

- HTTPS;
- compression;
- reverse proxy.

Но стоит добавить browser hardening:

- HSTS;
- `X-Content-Type-Options`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- clickjacking protection / `frame-ancestors`;
- CSP.

CSP для Next.js необходимо внедрять аккуратно, чтобы не сломать runtime scripts.

**Приоритет:** P1/P2.

---

## 7.8. P2 — CSRF defense-in-depth

Cookie auth + SameSite=Lax уже существенно снижает риск.

Тем не менее CORS не является CSRF protection.

Для mutation methods можно добавить:

- Origin validation;
- Referer validation;
- либо CSRF token strategy.

Особенно для:

```text
POST
PUT
PATCH
DELETE
```

**Приоритет:** P2.

---

## 7.9. P1 — file upload / preview availability

Upload ограничен 25 MB, но файл принимается целиком в memory buffer.

Дополнительно Office preview использует LibreOffice.

### Риск

Параллельные большие uploads или previews могут вызвать memory / CPU exhaustion.

### Рекомендация

- upload rate limit;
- preview concurrency limit;
- per-user quota;
- file type allowlist;
- streaming upload при дальнейшей нагрузке;
- preview queue;
- LibreOffice worker isolation / timeout.

**Приоритет:** P1 availability.

---

# 8. Observability

Текущий response timing logging слишком простой:

```text
Response time: N ms
```

Нужен structured production logging.

Пример:

```json
{
  "requestId": "...",
  "userId": "...",
  "method": "PATCH",
  "route": "/api/v1/...",
  "status": 200,
  "durationMs": 143
}
```

### Никогда не логировать

- password;
- JWT;
- Cookie;
- Authorization;
- MinIO secrets;
- DB password;
- полный sensitive payload.

### Желательно добавить

- requestId / correlationId;
- error monitoring;
- slow request threshold;
- DB query threshold;
- disk alert;
- backup failure alert;
- service health alert.

**Приоритет:** P2.

---

# 9. Backup / disaster recovery

Ручная production backup-процедура уже была проверена:

- PostgreSQL dump;
- MinIO archive;
- Redis archive;
- Caddy data/config;
- env backup;
- checksum;
- `pg_restore --list`;
- rollback Docker images.

Это хорошая release safety practice.

Но backup на том же VPS не является полноценным disaster recovery.

### Целевая схема

- daily PostgreSQL backup;
- daily / incremental MinIO backup;
- retention policy, например 7/30/90;
- encrypted off-server copy;
- backup status monitoring;
- регулярный restore test.

### Защищает от

- disk loss;
- VPS deletion;
- accidental deletion;
- ransomware;
- operator error.

**Приоритет:** P1.

---

# 10. Data model hardening

Prisma model в целом хороший.

Но многие state machine поля представлены как arbitrary strings:

```text
status String
type String
roleCode String
...
```

API validation снижает риск, но DB не защищена от ошибочного migration/script.

### Рекомендация

Постепенно переводить наиболее стабильные state machines в:

- Prisma enum;
- либо DB CHECK constraints.

Приоритетные кандидаты:

- OneTimeOrderStatus;
- TaskStatus;
- PaymentStatus;
- EmployeeStatus;
- CandidateStatus.

Не переводить все поля одним большим migration.

**Приоритет:** P2.

---

# 11. Frontend architecture

Сильные shared-компоненты уже появились:

- `SearchableSelect`;
- `MonthPeriodPicker`;
- Global Command;
- Global Create;
- role dashboards;
- workspace patterns;
- registry patterns.

Это хороший путь к design system.

### Долг

Крупные pages постепенно становятся orchestration + domain logic одновременно.

Пример направления декомпозиции:

```text
OrderPage
  OrderHeader
  OrderOverview
  OrderManagers
  OrderWorkforce
  OrderFinance
  OrderReview
  OrderHistory
```

Page должна постепенно становиться orchestration layer.

**Приоритет:** P2 / opportunistic refactor.

---

# 12. Testing gaps

Backend integration suite — сильная сторона.

Основной пробел — browser-level golden paths.

Нужен небольшой Playwright suite, например 10–15 сценариев:

### Auth

```text
login
→ dashboard
→ logout
```

### Regular object

```text
open object
→ attendance
→ daily report
→ history
→ timesheet
```

### One-time order

```text
manager opens order
→ workforce
→ consumables
→ completion
```

### Review

```text
deputy director
→ orders
→ Требуют отзыва
→ Написать отзыв
→ save
```

### ACL

```text
scoped user
→ cannot open foreign entity
```

Не требуется сотни frontend unit tests.

**Приоритет:** P2.

---

# 13. Recommended hardening backlog

## P0

На момент review подтверждённого P0 нет.

---

## P1

1. Исправить production auth rate limiting + trusted proxy.
2. Перевести limiter на Redis.
3. Ввести PostgreSQL least privilege.
4. Ввести MinIO least privilege.
5. Запретить production seed.
6. Автоматизировать off-server backups.
7. Ограничить upload / preview resource consumption.
8. Постепенно разгружать крупнейшие domain services.
9. Централизовать authoritative domain access predicates.
10. Добавить session revoke-all / refresh reuse hardening.

---

## P2

1. Security headers.
2. CSRF defense-in-depth.
3. Structured logging.
4. Monitoring / alerts.
5. DB status constraints / enums.
6. Docs reconciliation.
7. Golden-path browser E2E.
8. Frontend page decomposition.
9. Dependency / supply-chain review.
10. Регулярный security regression review.

---

# 14. Hardening Sprint — выполнить после продуктовой разработки

Согласованный технический пакет на конец текущего этапа:

```text
1. Auth/rate-limit/proxy hardening
2. DB least privilege
3. MinIO least privilege
4. Production seed guard
5. Security headers
6. Session revoke/reuse hardening
7. Backup automation
8. Service decomposition boundaries
9. Docs reconciliation
10. 10–15 golden-path E2E
```

Дополнительно в рамках security review:

```text
11. Full IDOR / entity-scope matrix
12. Mass-assignment verification
13. Sensitive log redaction review
14. Expensive-query / pagination DoS review
15. Upload / preview DoS hardening
16. Dependency / supply-chain review
17. CSRF policy
18. DB integrity constraints
```

---

# 15. Правило до Hardening Sprint

До отдельного hardening этапа:

- не делать глобальный rewrite;
- не переходить на микросервисы;
- не ломать существующие domain boundaries;
- новые ACL-правила добавлять через текущую capability/scope модель;
- новые sensitive операции обязательно закрывать integration tests;
- не запускать production seed;
- production migrations — только через `prisma migrate deploy`;
- не применять опасные DB/Docker reset-команды;
- при новых крупных доменах избегать дальнейшего роста существующих 2000–4000 line services;
- если изменение касается security-critical path, P1 из этого документа может быть поднят раньше общего hardening sprint.

---

# 16. Итог

Текущее состояние проекта можно охарактеризовать так:

> Архитектурный фундамент уже достаточно зрелый. Основной риск проекта теперь не в выборе framework или структуры приложения, а в постепенном расхождении бизнес-логики, ACL, документации и всё более сложного UI.

Поэтому дальнейшая стратегия:

```text
продолжить согласованную продуктовую разработку
→ завершить текущие Waves
→ выполнить отдельный Hardening Sprint
→ повторное security / architecture review
→ production acceptance
```

Переписывание системы не требуется.
