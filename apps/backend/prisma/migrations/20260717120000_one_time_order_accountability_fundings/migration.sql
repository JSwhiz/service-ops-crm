ALTER TABLE "accountability_fundings"
    ADD COLUMN "fundingType" TEXT NOT NULL DEFAULT 'manual_issue',
    ADD COLUMN "entryDirection" TEXT NOT NULL DEFAULT 'credit',
    ADD COLUMN "oneTimeOrderPaymentId" TEXT,
    ADD COLUMN "oneTimeOrderId" TEXT,
    ADD COLUMN "oneTimeOrderCompletionId" TEXT,
    ADD COLUMN "recordedByUserId" TEXT,
    ADD COLUMN "reversalOfFundingId" TEXT,
    ADD COLUMN "reversedByFundingId" TEXT;

ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_amount_positive_check"
        CHECK ("amount" > 0),
    ADD CONSTRAINT "accountability_fundings_type_check"
        CHECK ("fundingType" IN ('manual_issue', 'one_time_order_receipt', 'one_time_order_receipt_reversal', 'manual_correction')),
    ADD CONSTRAINT "accountability_fundings_direction_check"
        CHECK ("entryDirection" IN ('credit', 'debit'));

CREATE UNIQUE INDEX "accountability_fundings_oneTimeOrderPaymentId_key"
    ON "accountability_fundings"("oneTimeOrderPaymentId");
CREATE UNIQUE INDEX "accountability_fundings_reversalOfFundingId_key"
    ON "accountability_fundings"("reversalOfFundingId");
CREATE UNIQUE INDEX "accountability_fundings_reversedByFundingId_key"
    ON "accountability_fundings"("reversedByFundingId");
CREATE INDEX "accountability_fundings_recordedByUserId_idx"
    ON "accountability_fundings"("recordedByUserId");
CREATE INDEX "accountability_fundings_oneTimeOrderId_idx"
    ON "accountability_fundings"("oneTimeOrderId");
CREATE INDEX "accountability_fundings_oneTimeOrderCompletionId_idx"
    ON "accountability_fundings"("oneTimeOrderCompletionId");
CREATE INDEX "accountability_fundings_fundingType_idx"
    ON "accountability_fundings"("fundingType");
CREATE INDEX "accountability_fundings_entryDirection_idx"
    ON "accountability_fundings"("entryDirection");

ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_oneTimeOrderPaymentId_fkey"
    FOREIGN KEY ("oneTimeOrderPaymentId") REFERENCES "one_time_order_completion_payments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_oneTimeOrderId_fkey"
    FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_oneTimeOrderCompletionId_fkey"
    FOREIGN KEY ("oneTimeOrderCompletionId") REFERENCES "one_time_order_completions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_reversalOfFundingId_fkey"
    FOREIGN KEY ("reversalOfFundingId") REFERENCES "accountability_fundings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings"
    ADD CONSTRAINT "accountability_fundings_reversedByFundingId_fkey"
    FOREIGN KEY ("reversedByFundingId") REFERENCES "accountability_fundings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
