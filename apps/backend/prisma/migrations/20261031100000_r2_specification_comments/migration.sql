CREATE TABLE "one_time_order_specification_comments" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_order_specification_comments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "one_time_order_specification_comments_itemId_requestId_key"
ON "one_time_order_specification_comments"("itemId", "requestId");

CREATE INDEX "one_time_order_specification_comments_itemId_createdAt_idx"
ON "one_time_order_specification_comments"("itemId", "createdAt");

CREATE INDEX "one_time_order_specification_comments_createdByUserId_idx"
ON "one_time_order_specification_comments"("createdByUserId");

ALTER TABLE "one_time_order_specification_comments"
ADD CONSTRAINT "one_time_order_specification_comments_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "one_time_order_specification_items"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "one_time_order_specification_comments"
ADD CONSTRAINT "one_time_order_specification_comments_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
