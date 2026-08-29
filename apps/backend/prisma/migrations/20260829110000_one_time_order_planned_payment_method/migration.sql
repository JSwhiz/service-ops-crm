ALTER TABLE "one_time_orders"
  ADD COLUMN "plannedPaymentMethod" TEXT;

ALTER TABLE "one_time_orders"
  ADD CONSTRAINT "one_time_orders_plannedPaymentMethod_check"
  CHECK (
    "plannedPaymentMethod" IS NULL OR
    "plannedPaymentMethod" IN (
      'cash',
      'personal_card_transfer',
      'organization_transfer',
      'other'
    )
  );
