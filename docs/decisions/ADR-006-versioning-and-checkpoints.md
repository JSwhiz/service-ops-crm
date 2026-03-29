# ADR-006: Versioning and Stable Checkpoints

## Status

Accepted

## Context

The project is developed as a commercial monorepo with a long foundation phase and a need for safe rollback points. A stable checkpoint strategy is required before the domain modules start growing.

## Decision

Use:

- `main` as stable branch
- `dev` as integration branch
- `feature/*` as short-lived work branches
- semantic-style version tags for stable checkpoints

The first stable foundation checkpoint is:

- `v0.1.0`

## Consequences

### Positive

- safe rollback points
- clear distinction between working and stable states
- easier project handoff
- easier recovery from regressions
- better engineering discipline

### Negative

- requires active branch hygiene
- requires intentional tagging discipline
- adds process overhead compared to chaotic solo development

## Notes

A checkpoint is not only a git tag. It should also be documented in the repository as a short scope-fixed snapshot of what is included in that version.
