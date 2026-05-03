# Service Ops CRM

## Implemented product waves

### Foundation

- backend shell
- frontend shell
- auth foundation
- prisma foundation
- CI basics

### Objects

- objects foundation module
- object list
- object card foundation

### Object operations

- arrival photo foundation
- daily report foundation
- comments foundation
- feed foundation

### Tasks

- tasks foundation module
- selector-based task creation
- user-friendly status presentation

### Timesheets

- numeric day cell timesheet foundation
- employee rows and month totals
- improved timesheet grid

## Important architecture note

The project timesheet foundation is numeric-first.
The daily source from object card will be connected in the next microstage.

## Local runtime

### Host mode

```bash
pnpm bootstrap:local
pnpm --filter backend start:dev
pnpm --filter frontend dev
```

Useful commands:

```bash
pnpm infra:up
pnpm infra:ps
pnpm infra:logs
pnpm infra:down
pnpm infra:reset
```

### Docker mode

```bash
pnpm bootstrap:docker
```

Useful commands:

```bash
pnpm dev:docker:up
pnpm dev:docker:ps
pnpm dev:docker:logs
pnpm dev:docker:down
pnpm dev:docker:reset
```

### Bootstrap summary

Both bootstrap flows:

- create missing local env files from examples;
- prepare PostgreSQL, Redis and MinIO;
- generate Prisma client;
- apply Prisma migrations;
- run seed;
- ensure the first founder admin exists.
