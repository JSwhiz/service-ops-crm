ALTER TABLE "accountability_fundings"
  ADD COLUMN "source" TEXT;

ALTER TABLE "accountability_fundings"
  DROP CONSTRAINT "accountability_fundings_type_check",
  ADD CONSTRAINT "accountability_fundings_type_check"
    CHECK ("fundingType" IN (
      'manual_issue',
      'one_time_order_receipt',
      'one_time_order_receipt_reversal',
      'manual_correction',
      'external_receipt',
      'external_receipt_reversal'
    )),
  ADD CONSTRAINT "accountability_fundings_external_receipt_check"
    CHECK (
      "fundingType" <> 'external_receipt'
      OR (
        "entryDirection" = 'credit'
        AND length(trim(COALESCE("source", ''))) > 0
        AND length(trim(COALESCE("comment", ''))) > 0
        AND "oneTimeOrderPaymentId" IS NULL
        AND "oneTimeOrderId" IS NULL
        AND "oneTimeOrderCompletionId" IS NULL
      )
    ),
  ADD CONSTRAINT "accountability_fundings_external_receipt_reversal_check"
    CHECK (
      "fundingType" <> 'external_receipt_reversal'
      OR (
        "entryDirection" = 'debit'
        AND "reversalOfFundingId" IS NOT NULL
        AND "oneTimeOrderPaymentId" IS NULL
        AND "oneTimeOrderId" IS NULL
        AND "oneTimeOrderCompletionId" IS NULL
      )
    );

CREATE OR REPLACE FUNCTION prevent_funding_financial_mutation()
RETURNS trigger AS $$
BEGIN
    IF NEW."accountabilityAccountId" IS DISTINCT FROM OLD."accountabilityAccountId"
       OR NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."comment" IS DISTINCT FROM OLD."comment"
       OR NEW."source" IS DISTINCT FROM OLD."source"
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
