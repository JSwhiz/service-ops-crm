-- Model "no payment" without fake payment method/destination metadata.
ALTER TABLE "one_time_order_completion_payments"
  ALTER COLUMN "paymentMethod" DROP NOT NULL,
  ALTER COLUMN "paymentDestination" DROP NOT NULL;
