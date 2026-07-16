CREATE TABLE "one_time_order_completion_payments" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paymentDestination" TEXT NOT NULL,
    "zeroReason" TEXT,
    "comment" TEXT,
    "differenceReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reversalOfPaymentId" TEXT,
    "reversedByPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_completion_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "one_time_order_completion_payments_amount_check"
        CHECK ("amount" >= 0),
    CONSTRAINT "one_time_order_completion_payments_method_check"
        CHECK ("paymentMethod" IN ('cash', 'personal_card_transfer', 'organization_transfer', 'other')),
    CONSTRAINT "one_time_order_completion_payments_destination_check"
        CHECK ("paymentDestination" IN ('manager_accountability', 'organization')),
    CONSTRAINT "one_time_order_completion_payments_zero_reason_check"
        CHECK ("zeroReason" IS NULL OR "zeroReason" IN ('payment_later', 'paid_directly_to_organization', 'free_order', 'customer_did_not_pay', 'other')),
    CONSTRAINT "one_time_order_completion_payments_status_check"
        CHECK ("status" IN ('active', 'reversed'))
);

CREATE UNIQUE INDEX "one_time_order_completion_payments_reversalOfPaymentId_key"
    ON "one_time_order_completion_payments"("reversalOfPaymentId");
CREATE UNIQUE INDEX "one_time_order_completion_payments_reversedByPaymentId_key"
    ON "one_time_order_completion_payments"("reversedByPaymentId");
CREATE INDEX "one_time_order_completion_payments_completionId_idx"
    ON "one_time_order_completion_payments"("completionId");
CREATE INDEX "one_time_order_completion_payments_oneTimeOrderId_receivedAt_idx"
    ON "one_time_order_completion_payments"("oneTimeOrderId", "receivedAt");
CREATE INDEX "one_time_order_completion_payments_recipientUserId_idx"
    ON "one_time_order_completion_payments"("recipientUserId");
CREATE INDEX "one_time_order_completion_payments_recordedByUserId_idx"
    ON "one_time_order_completion_payments"("recordedByUserId");
CREATE INDEX "one_time_order_completion_payments_status_idx"
    ON "one_time_order_completion_payments"("status");

ALTER TABLE "one_time_order_completion_payments"
    ADD CONSTRAINT "one_time_order_completion_payments_completionId_fkey"
    FOREIGN KEY ("completionId") REFERENCES "one_time_order_completions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completion_payments"
    ADD CONSTRAINT "one_time_order_completion_payments_oneTimeOrderId_fkey"
    FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completion_payments"
    ADD CONSTRAINT "one_time_order_completion_payments_recipientUserId_fkey"
    FOREIGN KEY ("recipientUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completion_payments"
    ADD CONSTRAINT "one_time_order_completion_payments_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completion_payments"
    ADD CONSTRAINT "one_time_order_completion_payments_reversalOfPaymentId_fkey"
    FOREIGN KEY ("reversalOfPaymentId") REFERENCES "one_time_order_completion_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_completion_payments"
    ADD CONSTRAINT "one_time_order_completion_payments_reversedByPaymentId_fkey"
    FOREIGN KEY ("reversedByPaymentId") REFERENCES "one_time_order_completion_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
