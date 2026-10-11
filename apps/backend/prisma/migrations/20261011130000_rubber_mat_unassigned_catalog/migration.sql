-- Permit registered carpet assets to remain in the shared catalog before issue,
-- and to return to stock after removal from an object. Existing assignments remain.
ALTER TABLE "rubber_mats" ALTER COLUMN "objectId" DROP NOT NULL;
ALTER TABLE "rubber_mats" ALTER COLUMN "zone" DROP NOT NULL;

ALTER TABLE "rubber_mat_events" DROP CONSTRAINT "rubber_mat_events_action_valid";
ALTER TABLE "rubber_mat_events" ADD CONSTRAINT "rubber_mat_events_action_valid" CHECK (
  "action" IN ('registered', 'assigned', 'returned_to_stock', 'serviced', 'moved', 'condition_changed', 'retired')
);

CREATE INDEX "rubber_mats_objectId_idx" ON "rubber_mats"("objectId");
