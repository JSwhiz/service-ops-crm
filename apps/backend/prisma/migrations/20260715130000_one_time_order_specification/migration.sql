CREATE TABLE "one_time_order_specification_items" (
  "id" TEXT NOT NULL,
  "oneTimeOrderId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "requiresAttachment" BOOLEAN NOT NULL DEFAULT false,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedByUserId" TEXT,
  CONSTRAINT "one_time_order_specification_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "one_time_order_specification_items_oneTimeOrderId_fkey"
    FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "one_time_order_specification_items_completedByUserId_fkey"
    FOREIGN KEY ("completedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "one_time_order_specification_items_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "one_time_order_specification_items_deletedByUserId_fkey"
    FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "one_time_order_specification_items_oneTimeOrderId_sortOrder_idx"
  ON "one_time_order_specification_items"("oneTimeOrderId", "sortOrder");
CREATE INDEX "one_time_order_specification_items_completedByUserId_idx"
  ON "one_time_order_specification_items"("completedByUserId");
CREATE INDEX "one_time_order_specification_items_createdByUserId_idx"
  ON "one_time_order_specification_items"("createdByUserId");
CREATE INDEX "one_time_order_specification_items_deletedByUserId_idx"
  ON "one_time_order_specification_items"("deletedByUserId");
CREATE UNIQUE INDEX "one_time_order_specification_items_active_sort_key"
  ON "one_time_order_specification_items"("oneTimeOrderId", "sortOrder")
  WHERE "deletedAt" IS NULL;
