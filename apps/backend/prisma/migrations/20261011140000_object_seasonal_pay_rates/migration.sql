ALTER TABLE "objects"
  ADD COLUMN "summerPaymentType" TEXT NOT NULL DEFAULT 'daily',
  ADD COLUMN "summerDailyRate" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "summerMonthlySalary" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "winterPaymentType" TEXT NOT NULL DEFAULT 'daily',
  ADD COLUMN "winterDailyRate" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "winterMonthlySalary" INTEGER NOT NULL DEFAULT 0;

-- Preserve today's configured tariff as the initial baseline for both seasons.
-- Operators can then enter the actual summer/winter values without losing old rates.
UPDATE "objects"
SET "summerPaymentType" = "paymentType",
    "summerDailyRate" = "dailyRate",
    "summerMonthlySalary" = "monthlySalary",
    "winterPaymentType" = "paymentType",
    "winterDailyRate" = "dailyRate",
    "winterMonthlySalary" = "monthlySalary";
