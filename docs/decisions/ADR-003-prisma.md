# ADR-003: Prisma

## Status

Accepted

## Context

The backend requires a practical ORM/migration tool that supports a PostgreSQL-first workflow, predictable migrations and good developer experience for a small team.

## Decision

Use Prisma as the primary ORM and migration tool.

## Consequences

### Positive

- good DX for one developer
- readable schema
- structured migrations
- fast iteration

### Negative

- requires explicit separation between domain modeling and ORM modeling
- some advanced patterns may need care later
