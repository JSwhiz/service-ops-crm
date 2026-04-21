ALTER TABLE "inventory_movements"
  ADD COLUMN "approvalBridgeResolvedAt" TIMESTAMP(3),
  ADD COLUMN "approvalBridgeResolvedByUserId" TEXT;

CREATE INDEX "inventory_movements_approvalBridgeResolvedByUserId_idx"
  ON "inventory_movements"("approvalBridgeResolvedByUserId");

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_approvalBridgeResolvedByUserId_fkey"
  FOREIGN KEY ("approvalBridgeResolvedByUserId")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
