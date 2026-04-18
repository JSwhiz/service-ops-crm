-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "oneTimeOrderId" TEXT,
ALTER COLUMN "objectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "one_time_orders" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "executionAddress" TEXT NOT NULL,
    "linkedObjectId" TEXT,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "executionDate" TIMESTAMP(3),
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT,
    "agreedSum" INTEGER,
    "financialNotes" TEXT,
    "expenseNotes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_order_assignments" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentRoleCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_order_comments" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "commentType" TEXT NOT NULL DEFAULT 'manual',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "one_time_orders_linkedObjectId_idx" ON "one_time_orders"("linkedObjectId");

-- CreateIndex
CREATE INDEX "one_time_orders_status_idx" ON "one_time_orders"("status");

-- CreateIndex
CREATE INDEX "one_time_orders_createdByUserId_idx" ON "one_time_orders"("createdByUserId");

-- CreateIndex
CREATE INDEX "one_time_order_assignments_oneTimeOrderId_idx" ON "one_time_order_assignments"("oneTimeOrderId");

-- CreateIndex
CREATE INDEX "one_time_order_assignments_userId_idx" ON "one_time_order_assignments"("userId");

-- CreateIndex
CREATE INDEX "one_time_order_assignments_assignmentRoleCode_idx" ON "one_time_order_assignments"("assignmentRoleCode");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_order_assignments_oneTimeOrderId_userId_assignment_key" ON "one_time_order_assignments"("oneTimeOrderId", "userId", "assignmentRoleCode");

-- CreateIndex
CREATE INDEX "one_time_order_comments_oneTimeOrderId_createdAt_idx" ON "one_time_order_comments"("oneTimeOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "tasks_oneTimeOrderId_idx" ON "tasks"("oneTimeOrderId");

-- AddForeignKey
ALTER TABLE "one_time_orders" ADD CONSTRAINT "one_time_orders_linkedObjectId_fkey" FOREIGN KEY ("linkedObjectId") REFERENCES "objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_orders" ADD CONSTRAINT "one_time_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_assignments" ADD CONSTRAINT "one_time_order_assignments_oneTimeOrderId_fkey" FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_assignments" ADD CONSTRAINT "one_time_order_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_comments" ADD CONSTRAINT "one_time_order_comments_oneTimeOrderId_fkey" FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_comments" ADD CONSTRAINT "one_time_order_comments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_oneTimeOrderId_fkey" FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
