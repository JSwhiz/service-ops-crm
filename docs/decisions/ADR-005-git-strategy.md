# ADR-005: Git Strategy

## Status

Accepted

## Context

The project needs stable rollback points, clean history and a practical branch model suitable for one primary developer.

## Decision

Use:

- main as stable branch
- dev as integration branch
- feature/\* for work branches
- stable tags after significant checkpoints

## Consequences

### Positive

- clean rollback path
- safer integration flow
- stable release checkpoints

### Negative

- requires discipline
- direct work in main must be avoided
