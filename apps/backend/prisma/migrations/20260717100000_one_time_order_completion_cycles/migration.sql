ALTER TABLE "one_time_orders"
    ADD COLUMN "workCycle" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "completedByUserId" TEXT;

UPDATE "one_time_orders"
SET
    "completedAt" = "updatedAt",
    "completedByUserId" = "createdByUserId"
WHERE "status" = 'completed';

CREATE TABLE "one_time_order_completions" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "workCycle" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "completedByUserId" TEXT NOT NULL,
    "completionComment" TEXT,
    "status" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "payloadFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_completions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "one_time_order_completions_status_check"
        CHECK ("status" IN ('active', 'superseded')),
    CONSTRAINT "one_time_order_completions_work_cycle_check"
        CHECK ("workCycle" > 0)
);

INSERT INTO "one_time_order_completions" (
    "id",
    "oneTimeOrderId",
    "workCycle",
    "completedAt",
    "completedByUserId",
    "completionComment",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    md5('legacy-one-time-order-completion:' || "id"),
    "id",
    1,
    "completedAt",
    "completedByUserId",
    'Legacy completion backfill',
    'active',
    "completedAt",
    "completedAt"
FROM "one_time_orders"
WHERE "status" = 'completed';

CREATE UNIQUE INDEX "one_time_order_completions_oneTimeOrderId_workCycle_key"
    ON "one_time_order_completions"("oneTimeOrderId", "workCycle");
CREATE UNIQUE INDEX "one_time_order_completions_oneTimeOrderId_clientRequestId_key"
    ON "one_time_order_completions"("oneTimeOrderId", "clientRequestId");
CREATE INDEX "one_time_order_completions_oneTimeOrderId_completedAt_idx"
    ON "one_time_order_completions"("oneTimeOrderId", "completedAt");
CREATE INDEX "one_time_order_completions_completedByUserId_idx"
    ON "one_time_order_completions"("completedByUserId");
CREATE INDEX "one_time_orders_completedByUserId_idx"
    ON "one_time_orders"("completedByUserId");

ALTER TABLE "one_time_orders"
    ADD CONSTRAINT "one_time_orders_completedByUserId_fkey"
    FOREIGN KEY ("completedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completions"
    ADD CONSTRAINT "one_time_order_completions_oneTimeOrderId_fkey"
    FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completions"
    ADD CONSTRAINT "one_time_order_completions_completedByUserId_fkey"
    FOREIGN KEY ("completedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
