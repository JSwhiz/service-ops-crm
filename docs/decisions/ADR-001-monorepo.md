# ADR-001: Monorepo

## Status

Accepted

## Context

The project contains a tightly coupled frontend, backend, infrastructure layer and shared architectural documentation. The system is developed by a very small team, initially one primary developer.

## Decision

Use a single private monorepo with:

- apps/
- packages/
- infra/
- docs/

## Consequences

### Positive

- single source of truth
- synchronized frontend/backend evolution
- shared tooling
- easier onboarding
- simpler versioning and rollback discipline

### Negative

- root-level discipline is required
- package boundaries must be respected
- root package must not become a dumping ground
