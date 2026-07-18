-- Financial provenance must survive parent lifecycle operations.
ALTER TABLE "one_time_order_completions"
    DROP CONSTRAINT "one_time_order_completions_oneTimeOrderId_fkey",
    ADD CONSTRAINT "one_time_order_completions_oneTimeOrderId_fkey"
        FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "one_time_order_completion_payments"
    DROP CONSTRAINT "one_time_order_completion_payments_completionId_fkey",
    DROP CONSTRAINT "one_time_order_completion_payments_oneTimeOrderId_fkey",
    ADD CONSTRAINT "one_time_order_completion_payments_completionId_fkey"
        FOREIGN KEY ("completionId") REFERENCES "one_time_order_completions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "one_time_order_completion_payments_oneTimeOrderId_fkey"
        FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accountability_accounts"
    DROP CONSTRAINT "accountability_accounts_userId_fkey",
    ADD CONSTRAINT "accountability_accounts_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accountability_fundings"
    DROP CONSTRAINT "accountability_fundings_accountabilityAccountId_fkey",
    DROP CONSTRAINT "accountability_fundings_recordedByUserId_fkey",
    DROP CONSTRAINT "accountability_fundings_oneTimeOrderPaymentId_fkey",
    DROP CONSTRAINT "accountability_fundings_oneTimeOrderId_fkey",
    DROP CONSTRAINT "accountability_fundings_oneTimeOrderCompletionId_fkey",
    ADD CONSTRAINT "accountability_fundings_accountabilityAccountId_fkey"
        FOREIGN KEY ("accountabilityAccountId") REFERENCES "accountability_accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_fundings_recordedByUserId_fkey"
        FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_fundings_oneTimeOrderPaymentId_fkey"
        FOREIGN KEY ("oneTimeOrderPaymentId") REFERENCES "one_time_order_completion_payments"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_fundings_oneTimeOrderId_fkey"
        FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_fundings_oneTimeOrderCompletionId_fkey"
        FOREIGN KEY ("oneTimeOrderCompletionId") REFERENCES "one_time_order_completions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accountability_expenses"
    DROP CONSTRAINT "accountability_expenses_accountabilityAccountId_fkey",
    DROP CONSTRAINT "accountability_expenses_oneTimeOrderId_fkey",
    DROP CONSTRAINT "accountability_expenses_oneTimeOrderCompletionId_fkey",
    DROP CONSTRAINT "accountability_expenses_approvedByUserId_fkey",
    DROP CONSTRAINT "accountability_expenses_rejectedByUserId_fkey",
    ADD CONSTRAINT "accountability_expenses_accountabilityAccountId_fkey"
        FOREIGN KEY ("accountabilityAccountId") REFERENCES "accountability_accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_expenses_oneTimeOrderId_fkey"
        FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_expenses_oneTimeOrderCompletionId_fkey"
        FOREIGN KEY ("oneTimeOrderCompletionId") REFERENCES "one_time_order_completions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_expenses_approvedByUserId_fkey"
        FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_expenses_rejectedByUserId_fkey"
        FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accountability_closures"
    DROP CONSTRAINT "accountability_closures_accountabilityAccountId_fkey",
    DROP CONSTRAINT "accountability_closures_approvedByUserId_fkey",
    DROP CONSTRAINT "accountability_closures_rejectedByUserId_fkey",
    ADD CONSTRAINT "accountability_closures_accountabilityAccountId_fkey"
        FOREIGN KEY ("accountabilityAccountId") REFERENCES "accountability_accounts"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_closures_approvedByUserId_fkey"
        FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "accountability_closures_rejectedByUserId_fkey"
        FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_payment_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF NEW."completionId" IS DISTINCT FROM OLD."completionId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."recipientUserId" IS DISTINCT FROM OLD."recipientUserId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
       OR NEW."paymentDestination" IS DISTINCT FROM OLD."paymentDestination"
       OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
       OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId" THEN
        RAISE EXCEPTION 'Posted payment financial fields are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER one_time_order_payment_financial_immutable
BEFORE UPDATE ON "one_time_order_completion_payments"
FOR EACH ROW EXECUTE FUNCTION prevent_payment_financial_mutation();

CREATE OR REPLACE FUNCTION prevent_funding_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF NEW."accountabilityAccountId" IS DISTINCT FROM OLD."accountabilityAccountId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."fundingType" IS DISTINCT FROM OLD."fundingType"
       OR NEW."entryDirection" IS DISTINCT FROM OLD."entryDirection"
       OR NEW."oneTimeOrderPaymentId" IS DISTINCT FROM OLD."oneTimeOrderPaymentId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."oneTimeOrderCompletionId" IS DISTINCT FROM OLD."oneTimeOrderCompletionId" THEN
        RAISE EXCEPTION 'Posted funding financial fields are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accountability_funding_financial_immutable
BEFORE UPDATE ON "accountability_fundings"
FOR EACH ROW EXECUTE FUNCTION prevent_funding_financial_mutation();

CREATE OR REPLACE FUNCTION prevent_posted_expense_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF OLD."status" <> 'draft' AND (
       NEW."accountabilityAccountId" IS DISTINCT FROM OLD."accountabilityAccountId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."oneTimeOrderCompletionId" IS DISTINCT FROM OLD."oneTimeOrderCompletionId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    ) THEN
        RAISE EXCEPTION 'Posted expense financial fields are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accountability_posted_expense_financial_immutable
BEFORE UPDATE ON "accountability_expenses"
FOR EACH ROW EXECUTE FUNCTION prevent_posted_expense_financial_mutation();
