CREATE TABLE "rubber_mats" (
  "id" TEXT NOT NULL,
  "inventoryCode" TEXT,
  "objectId" TEXT NOT NULL,
  "zone" TEXT NOT NULL,
  "lengthCm" DECIMAL(8,2) NOT NULL,
  "widthCm" DECIMAL(8,2) NOT NULL,
  "thicknessMm" DECIMAL(8,2),
  "condition" TEXT NOT NULL DEFAULT 'good',
  "installedAt" DATE,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rubber_mats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rubber_mats_dimensions_positive" CHECK (
    "lengthCm" > 0 AND "widthCm" > 0 AND ("thicknessMm" IS NULL OR "thicknessMm" > 0)
  ),
  CONSTRAINT "rubber_mats_condition_valid" CHECK (
    "condition" IN ('good', 'worn', 'damaged', 'retired')
  ),
  CONSTRAINT "rubber_mats_object_fkey" FOREIGN KEY ("objectId")
    REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rubber_mats_createdByUserId_fkey" FOREIGN KEY ("createdByUserId")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "rubber_mats_inventoryCode_key" ON "rubber_mats"("inventoryCode");
CREATE INDEX "rubber_mats_objectId_condition_idx" ON "rubber_mats"("objectId", "condition");
CREATE INDEX "rubber_mats_createdAt_idx" ON "rubber_mats"("createdAt");

CREATE TABLE "rubber_mat_events" (
  "id" TEXT NOT NULL,
  "rubberMatId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromObjectId" TEXT,
  "toObjectId" TEXT,
  "fromCondition" TEXT,
  "toCondition" TEXT,
  "fromZone" TEXT,
  "toZone" TEXT,
  "note" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rubber_mat_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rubber_mat_events_action_valid" CHECK (
    "action" IN ('registered', 'serviced', 'moved', 'condition_changed', 'retired')
  ),
  CONSTRAINT "rubber_mat_events_rubberMatId_fkey" FOREIGN KEY ("rubberMatId")
    REFERENCES "rubber_mats"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rubber_mat_events_actorUserId_fkey" FOREIGN KEY ("actorUserId")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "rubber_mat_events_rubberMatId_occurredAt_idx"
  ON "rubber_mat_events"("rubberMatId", "occurredAt");
CREATE INDEX "rubber_mat_events_actorUserId_idx" ON "rubber_mat_events"("actorUserId");
