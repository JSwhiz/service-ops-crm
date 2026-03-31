# Local Setup

## Что уже должно быть готово

На текущем этапе уже должны быть готовы:

- auth foundation
- prisma foundation
- objects foundation
- object operations foundation
- tasks foundation
- task UX hardening
- timesheet numeric foundation

## Основной локальный цикл

```bash
make infra-up
pnpm install
make db-generate
make db-migrate
make db-seed
pnpm --filter backend start:dev
pnpm --filter frontend dev
pnpm ci:check
```
