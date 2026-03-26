# ADR-002: pnpm Workspace

## Status

Accepted

## Context

The project requires workspace support, shared packages, deterministic dependency boundaries and a lightweight monorepo-friendly package manager.

## Decision

Use pnpm workspace.

## Consequences

### Positive

- good monorepo support
- efficient dependency storage
- stronger dependency discipline
- clean package boundaries

### Negative

- requires explicit workspace thinking
- some developers may be more familiar with npm
