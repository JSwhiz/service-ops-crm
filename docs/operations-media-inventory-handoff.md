# Operational media and inventory — parent integration

Integration status 2026-10-26: integrated locally. `InventoryService.correctMovement`, the object inventory action, shared batch/file retry handling, task creation/detail/result attachments and daily report forms are wired. Schema/client generation and the remaining-operations migration are integrated. See `docs/verification-2026-10-26.md` for actual checks and blockers; the coordination notes below are historical implementation guidance, not a claim of pending parent work.

Scope: roadmap 11, 12, 14, 32, 37, 41. Local only; no schema, seed or migration edits by this slice.

## Early schema coordination

The existing InventoryMovement + transactional AuditEvent are sufficient for cancellation and full compensating reversal: lock the source movement, persist one `inventory.movement.reversed` audit with the return movement ID, reason, actor and timestamp in the same transaction. Concurrent/repeated requests read that persisted result under the same source lock. No schema change is required by this implementation. A future first-class `reversalOfMovementId String? @unique` relation would make reporting easier, but is not a prerequisite and is not introduced here.

File metadata already preserves uploadedByUserId and createdAt. File.deletedAt supports logical removal; confirmed inventory evidence is retained. No new media schema is needed.

## Parent-owned consumers (do not edit from this slice)

- `apps/backend/src/modules/object-operations/object-operations.service.ts`: daily-report save must retain the created report on upload failure. Do not recreate a report when retrying attachments. Shared file API permits subsequent uploads using `object_daily_report` and the returned report ID.
- `apps/frontend/src/app/(app)/objects/[id]/page.tsx`: report upload callback must report successful files incrementally / use the shared batch helper (integration details to follow). Keep the saved report ID on partial failure. One general image is sufficient for inventory evidence; do not require an image per line.

Implementation and verification results will be appended after changes.
