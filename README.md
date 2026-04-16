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

## Local bootstrap

For a clean local environment:

```bash
pnpm bootstrap:local
```

The bootstrap flow:

- creates missing local env files from examples;
- starts PostgreSQL, Redis and MinIO through `docker-compose.dev.yml`;
- waits until infra ports are reachable;
- generates Prisma client;
- applies Prisma migrations;
- runs seed;
- ensures the first founder admin exists.

After bootstrap:

```bash
pnpm --filter backend start:dev
pnpm --filter frontend dev
```
