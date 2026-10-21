-- Employees keep several phone numbers like candidates; "phone" stays the main number.
ALTER TABLE "employees"
  ADD COLUMN "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "employees" SET "phones" = ARRAY[btrim("phone")]
WHERE "phone" IS NOT NULL AND btrim("phone") <> '';
