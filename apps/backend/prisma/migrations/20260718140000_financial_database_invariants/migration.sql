CREATE OR REPLACE FUNCTION prevent_payment_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF NEW."completionId" IS DISTINCT FROM OLD."completionId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."recipientUserId" IS DISTINCT FROM OLD."recipientUserId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
       OR NEW."paymentDestination" IS DISTINCT FROM OLD."paymentDestination"
       OR NEW."zeroReason" IS DISTINCT FROM OLD."zeroReason"
       OR NEW."comment" IS DISTINCT FROM OLD."comment"
       OR NEW."differenceReason" IS DISTINCT FROM OLD."differenceReason"
       OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
       OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId"
       OR NEW."reversalOfPaymentId" IS DISTINCT FROM OLD."reversalOfPaymentId"
       OR NEW."correctedFromPaymentId" IS DISTINCT FROM OLD."correctedFromPaymentId" THEN
        RAISE EXCEPTION 'Posted payment fields are immutable';
    END IF;

    IF NEW."status" IS DISTINCT FROM OLD."status"
       AND NOT (OLD."status" = 'active' AND NEW."status" = 'reversed') THEN
        RAISE EXCEPTION 'Invalid payment status transition';
    END IF;

    IF NEW."status" NOT IN ('active', 'reversal', 'reversed') THEN
        RAISE EXCEPTION 'Invalid payment status';
    END IF;

    IF OLD."reversedByPaymentId" IS NOT NULL
       AND NEW."reversedByPaymentId" IS DISTINCT FROM OLD."reversedByPaymentId" THEN
        RAISE EXCEPTION 'Payment reversal link is immutable';
    END IF;

    IF OLD."correctedByPaymentId" IS NOT NULL
       AND NEW."correctedByPaymentId" IS DISTINCT FROM OLD."correctedByPaymentId" THEN
        RAISE EXCEPTION 'Payment correction link is immutable';
    END IF;

    IF NEW."status" = 'reversed' AND NEW."reversedByPaymentId" IS NULL THEN
        RAISE EXCEPTION 'Reversed payment requires reversal link';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_funding_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF NEW."accountabilityAccountId" IS DISTINCT FROM OLD."accountabilityAccountId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."comment" IS DISTINCT FROM OLD."comment"
       OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
       OR NEW."issuedByUserId" IS DISTINCT FROM OLD."issuedByUserId"
       OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId"
       OR NEW."fundingType" IS DISTINCT FROM OLD."fundingType"
       OR NEW."entryDirection" IS DISTINCT FROM OLD."entryDirection"
       OR NEW."oneTimeOrderPaymentId" IS DISTINCT FROM OLD."oneTimeOrderPaymentId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."oneTimeOrderCompletionId" IS DISTINCT FROM OLD."oneTimeOrderCompletionId"
       OR NEW."reversalOfFundingId" IS DISTINCT FROM OLD."reversalOfFundingId" THEN
        RAISE EXCEPTION 'Posted funding fields are immutable';
    END IF;

    IF OLD."reversedByFundingId" IS NOT NULL
       AND NEW."reversedByFundingId" IS DISTINCT FROM OLD."reversedByFundingId" THEN
        RAISE EXCEPTION 'Funding reversal link is immutable';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_posted_expense_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF OLD."status" <> 'draft' AND (
       NEW."accountabilityAccountId" IS DISTINCT FROM OLD."accountabilityAccountId"
       OR NEW."oneTimeOrderId" IS DISTINCT FROM OLD."oneTimeOrderId"
       OR NEW."oneTimeOrderCompletionId" IS DISTINCT FROM OLD."oneTimeOrderCompletionId"
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

CREATE OR REPLACE FUNCTION prevent_financial_history_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Posted financial history cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_native_completion_delete()
RETURNS trigger AS $$
BEGIN
    IF OLD."completionSource" = 'native' THEN
        RAISE EXCEPTION 'Native completion cannot be deleted';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_posted_expense_delete()
RETURNS trigger AS $$
BEGIN
    IF OLD."status" <> 'draft' THEN
        RAISE EXCEPTION 'Posted expense cannot be deleted';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER one_time_order_payment_delete_restricted
BEFORE DELETE ON "one_time_order_completion_payments"
FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_delete();

CREATE TRIGGER accountability_funding_delete_restricted
BEFORE DELETE ON "accountability_fundings"
FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_delete();

CREATE TRIGGER one_time_order_completion_delete_restricted
BEFORE DELETE ON "one_time_order_completions"
FOR EACH ROW EXECUTE FUNCTION prevent_native_completion_delete();

CREATE TRIGGER accountability_posted_expense_delete_restricted
BEFORE DELETE ON "accountability_expenses"
FOR EACH ROW EXECUTE FUNCTION prevent_posted_expense_delete();
