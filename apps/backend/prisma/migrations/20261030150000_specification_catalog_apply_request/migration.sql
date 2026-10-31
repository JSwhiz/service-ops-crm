CREATE TABLE "one_time_order_specification_apply_requests" (
  "id" TEXT NOT NULL,
  "oneTimeOrderId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "itemIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "one_time_order_specification_apply_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "one_time_order_specification_apply_requests_oneTimeOrderId_fkey"
    FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "one_time_order_specification_apply_requests_oneTimeOrderId_requestId_key"
  ON "one_time_order_specification_apply_requests"("oneTimeOrderId", "requestId");
CREATE INDEX "one_time_order_specification_apply_requests_createdAt_idx"
  ON "one_time_order_specification_apply_requests"("createdAt");
