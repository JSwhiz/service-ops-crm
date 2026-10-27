ALTER TABLE "objects" ADD COLUMN "baseCompensationProfile" JSONB;
UPDATE "objects" SET "baseCompensationProfile" = jsonb_build_object(
  'paymentType', "paymentType", 'dailyRate', "dailyRate", 'monthlySalary', "monthlySalary",
  'paymentScheduleCode', "paymentScheduleCode", 'paymentScheduleWeekdays', "paymentScheduleWeekdays",
  'paymentScheduleCycleStartDate', "paymentScheduleCycleStartDate"
);
ALTER TABLE "chat_messages" ADD COLUMN "systemEventKey" TEXT;
CREATE UNIQUE INDEX "chat_messages_systemEventKey_key" ON "chat_messages"("systemEventKey");
CREATE TABLE "object_contacts" (
  "id" TEXT PRIMARY KEY, "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "position" TEXT, "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "links" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "object_contacts_objectId_idx" ON "object_contacts"("objectId");
CREATE TABLE "object_planning_settings" (
  "objectId" TEXT PRIMARY KEY REFERENCES "objects"("id") ON DELETE CASCADE,
  "monthlyBudget" DECIMAL(14,2), "automaticSeasons" BOOLEAN NOT NULL DEFAULT false,
  "summerStartsOn" TEXT, "winterStartsOn" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "object_budget_nonnegative" CHECK ("monthlyBudget" IS NULL OR "monthlyBudget" >= 0)
);
CREATE TABLE "object_budget_periods" (
  "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE, "month" TEXT NOT NULL,
  "actualAmount" DECIMAL(14,2) NOT NULL DEFAULT 0, "excessAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("objectId", "month")
);
CREATE TABLE "object_budget_alerts" (
  "id" TEXT PRIMARY KEY, "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE,
  "month" TEXT NOT NULL, "revision" INTEGER NOT NULL, "planAmount" DECIMAL(14,2) NOT NULL,
  "actualAmount" DECIMAL(14,2) NOT NULL, "excessAmount" DECIMAL(14,2) NOT NULL,
  "chatDeliveredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("objectId", "month", "revision")
);
CREATE INDEX "object_budget_alerts_chatDeliveredAt_idx" ON "object_budget_alerts"("chatDeliveredAt");
