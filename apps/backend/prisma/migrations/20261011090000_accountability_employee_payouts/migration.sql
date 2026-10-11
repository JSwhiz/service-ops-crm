ALTER TABLE "accountability_expenses"
  ADD COLUMN "oneTimeOrderWorkCycle" INTEGER,
  ADD COLUMN "employeeId" TEXT;

ALTER TABLE "accountability_expenses"
  DROP CONSTRAINT "accountability_expenses_expenseCategory_check",
  ADD CONSTRAINT "accountability_expenses_expenseCategory_check"
    CHECK (
      "expenseCategory" IS NULL OR
      "expenseCategory" IN (
        'consumables', 'delivery', 'transport', 'services', 'other',
        'employee_payout'
      )
    ),
  ADD CONSTRAINT "accountability_expenses_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accountability_expenses_employee_payout_fields_check"
    CHECK (
      "expenseCategory" <> 'employee_payout' OR
      (
        "oneTimeOrderId" IS NOT NULL AND
        "oneTimeOrderWorkCycle" IS NOT NULL AND
        "oneTimeOrderWorkCycle" > 0 AND
        "employeeId" IS NOT NULL AND
        "expenseDate" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "accountability_expenses_non_payout_employee_fields_check"
    CHECK (
      "expenseCategory" = 'employee_payout' OR
      ("employeeId" IS NULL AND "oneTimeOrderWorkCycle" IS NULL)
    );

CREATE INDEX "accountability_expenses_order_cycle_employee_idx"
  ON "accountability_expenses"("oneTimeOrderId", "oneTimeOrderWorkCycle", "employeeId");
CREATE INDEX "accountability_expenses_employee_date_idx"
  ON "accountability_expenses"("employeeId", "expenseDate");

CREATE OR REPLACE FUNCTION prevent_posted_expense_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF OLD."status" <> 'draft' AND (
       NEW."accountabilityAccountId" IS DISTINCT FROM OLD."accountabilityAccountId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."oneTimeOrderCompletionId" IS DISTINCT FROM OLD."oneTimeOrderCompletionId"
       OR NEW."oneTimeOrderWorkCycle" IS DISTINCT FROM OLD."oneTimeOrderWorkCycle"
       OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."expenseCategory" IS DISTINCT FROM OLD."expenseCategory"
       OR NEW."expenseDate" IS DISTINCT FROM OLD."expenseDate"
       OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    ) THEN
        RAISE EXCEPTION 'Posted expense fields are immutable';
    END IF;

    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'draft' AND NEW."status" = 'submitted')
       OR (OLD."status" = 'submitted' AND NEW."status" IN ('approved', 'rejected'))
       OR (OLD."status" = 'approved' AND NEW."status" = 'reconciled')
    ) THEN
        RAISE EXCEPTION 'Invalid expense status transition';
    END IF;

    IF NEW."status" = 'submitted' AND NEW."submittedAt" IS NULL THEN
        RAISE EXCEPTION 'Submitted expense requires submittedAt';
    END IF;

    IF NEW."status" = 'approved' AND
       (NEW."approvedByUserId" IS NULL OR NEW."approvedAt" IS NULL
        OR NEW."rejectedByUserId" IS NOT NULL OR NEW."rejectedAt" IS NOT NULL) THEN
        RAISE EXCEPTION 'Approved expense metadata is inconsistent';
    END IF;

    IF NEW."status" = 'rejected' AND
       (NEW."rejectedByUserId" IS NULL OR NEW."rejectedAt" IS NULL
        OR NEW."approvedByUserId" IS NOT NULL OR NEW."approvedAt" IS NOT NULL) THEN
        RAISE EXCEPTION 'Rejected expense metadata is inconsistent';
    END IF;

    IF NEW."status" = 'reconciled' AND
       (NEW."approvedByUserId" IS NULL OR NEW."approvedAt" IS NULL
        OR NEW."reconciledAt" IS NULL) THEN
        RAISE EXCEPTION 'Reconciled expense metadata is inconsistent';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
