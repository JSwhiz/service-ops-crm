ALTER TABLE "accountability_expenses"
ADD COLUMN "oneTimeOrderId" TEXT,
ADD COLUMN "oneTimeOrderCompletionId" TEXT,
ADD COLUMN "expenseCategory" TEXT,
ADD COLUMN "expenseDate" DATE;

ALTER TABLE "accountability_expenses"
ADD CONSTRAINT "accountability_expenses_expenseCategory_check"
CHECK (
  "expenseCategory" IS NULL OR
  "expenseCategory" IN ('consumables', 'delivery', 'transport', 'services', 'other')
);

ALTER TABLE "accountability_expenses"
ADD CONSTRAINT "accountability_expenses_oneTimeOrderId_fkey"
FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accountability_expenses"
ADD CONSTRAINT "accountability_expenses_oneTimeOrderCompletionId_fkey"
FOREIGN KEY ("oneTimeOrderCompletionId") REFERENCES "one_time_order_completions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "accountability_expenses_oneTimeOrderId_createdAt_idx"
ON "accountability_expenses"("oneTimeOrderId", "createdAt");

CREATE INDEX "accountability_expenses_oneTimeOrderCompletionId_idx"
ON "accountability_expenses"("oneTimeOrderCompletionId");

CREATE INDEX "accountability_expenses_expenseCategory_idx"
ON "accountability_expenses"("expenseCategory");

CREATE INDEX "accountability_expenses_expenseDate_idx"
ON "accountability_expenses"("expenseDate");
