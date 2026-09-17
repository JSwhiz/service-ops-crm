# Repository instructions

## Read docs first

Before changing code, always read and use these files as the primary project contract:

- docs/product/product-contract.md
- docs/architecture/access-matrix.md
- docs/architecture/glossary.md
- docs/product/open-questions-register.md
- docs/product/reconciliation-notes.md
- docs/product/golden-path-index.md

## Contract priority

When code and old comments conflict with these docs:

1. follow the current task prompt
2. follow the docs listed above
3. then follow older local conventions only if they do not conflict

## Architecture rules

- Do not invent new role names if an existing canonical role exists in glossary/access-matrix.
- Do not merge `user` and `employee`.
- Do not merge object comments with chats.
- Do not treat staffing, attendance, and timesheet as the same entity.
- Before adding a new field, check whether the term/entity already exists in product-contract or glossary.
- If a rule is unresolved, update open-questions-register instead of silently choosing a business rule in code.

## For implementation tasks

When changing backend access logic, always verify against:

- docs/architecture/access-matrix.md

When changing domain terms, always verify against:

- docs/architecture/glossary.md

When adding or changing module scope, always verify against:

- docs/product/product-contract.md

## Frontend UI contract

Before any frontend visual/UI changes, read:

- docs/ui/UI_AUDIT.md
- docs/ui/UI_ARCHITECTURE.md
- docs/ui/COMPONENT_CONTRACTS.md
- docs/ui/MODULE_ROADMAP.md

These UI documents supplement the primary product contracts listed under Read docs first. They do not override business/product documentation or change Contract priority.

- Do not introduce a new visual pattern when an existing documented pattern solves the task.
- UI-only tasks do not change API, DTO, ACL, schema, or business lifecycle.
- Shared primitives evolve through real consumers; do not implement optional capabilities in advance "just in case".
- Do not rewrite existing reference implementations without a concrete reason.
- Reference implementations: App shell, Login, Dashboard, Objects registry, Objects detail.
- Preserve Objects detail anchor navigation as an intentional exception.
- A Chats visual refactor must not simultaneously move or rewrite realtime effects, socket ordering, deduplication, or the scroll controller.
- Replace browser-native confirm/prompt gradually within the migration of the corresponding module.
