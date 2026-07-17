ALTER TABLE "one_time_order_completion_payments"
ADD COLUMN "correctedFromPaymentId" TEXT,
ADD COLUMN "correctedByPaymentId" TEXT;

CREATE UNIQUE INDEX "one_time_order_completion_payments_correctedFromPaymentId_key"
ON "one_time_order_completion_payments"("correctedFromPaymentId");

CREATE UNIQUE INDEX "one_time_order_completion_payments_correctedByPaymentId_key"
ON "one_time_order_completion_payments"("correctedByPaymentId");

ALTER TABLE "one_time_order_completion_payments"
ADD CONSTRAINT "one_time_order_completion_payments_correctedFromPaymentId_fkey"
FOREIGN KEY ("correctedFromPaymentId")
REFERENCES "one_time_order_completion_payments"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "one_time_order_completion_payments"
ADD CONSTRAINT "one_time_order_completion_payments_correctedByPaymentId_fkey"
FOREIGN KEY ("correctedByPaymentId")
REFERENCES "one_time_order_completion_payments"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
