# ADR-004: Docker Strategy

## Status

Accepted

## Context

The project requires reproducible local infrastructure and a future deployment path without forcing unnecessary complexity into daily development.

## Decision

Use Docker Compose for infrastructure from the beginning:

- PostgreSQL
- Redis
- MinIO

Frontend and backend may initially run locally in dev mode, while Dockerfiles are prepared for future containerized deployment.

## Consequences

### Positive

- reproducible local infra
- easier future deployment path
- lower dev friction compared to fully containerized local app development

### Negative

- mixed local+container workflow must be documented clearly
