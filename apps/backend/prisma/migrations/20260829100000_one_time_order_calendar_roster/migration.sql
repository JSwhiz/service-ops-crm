CREATE TABLE "one_time_order_calendar_managers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isVisible" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "one_time_order_calendar_managers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "one_time_order_calendar_managers_userId_key"
  ON "one_time_order_calendar_managers"("userId");
CREATE INDEX "one_time_order_calendar_managers_isVisible_sortOrder_idx"
  ON "one_time_order_calendar_managers"("isVisible", "sortOrder");

ALTER TABLE "one_time_order_calendar_managers"
  ADD CONSTRAINT "one_time_order_calendar_managers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "one_time_order_calendar_managers"
  ("id", "userId", "isVisible", "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "id",
  true,
  CASE "login"
    WHEN 'drozdovskiy' THEN 1
    WHEN 'berendyakov' THEN 2
    WHEN 'gomonova' THEN 3
    WHEN 'sycheva' THEN 4
    WHEN 'eliseeva' THEN 5
    WHEN 'milov' THEN 6
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users"
WHERE "login" IN (
  'drozdovskiy',
  'berendyakov',
  'gomonova',
  'sycheva',
  'eliseeva',
  'milov'
)
ON CONFLICT ("userId") DO UPDATE SET
  "isVisible" = EXCLUDED."isVisible",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;
