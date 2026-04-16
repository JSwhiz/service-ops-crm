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
