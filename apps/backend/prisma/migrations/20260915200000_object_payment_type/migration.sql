ALTER TABLE "objects"
  ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'daily';

UPDATE "objects"
SET "paymentType" = CASE
  WHEN "monthlySalary" > 0 THEN 'monthly'
  ELSE 'daily'
END;

ALTER TABLE "objects"
  ADD CONSTRAINT "objects_payment_type_check"
  CHECK ("paymentType" IN ('monthly', 'daily'));

CREATE INDEX "objects_paymentType_idx"
  ON "objects"("paymentType");
