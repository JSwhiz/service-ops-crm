ALTER TABLE "inventory_items" ADD COLUMN "currentUnitPrice" DECIMAL(12,2);

ALTER TABLE "inventory_movements" ADD COLUMN "unitPriceSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "inventory_movements" ADD COLUMN "totalAmountSnapshot" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "inventory_movements" ADD COLUMN "requiresApprovalBridge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_movements" ADD COLUMN "approvalBridgeType" TEXT;
