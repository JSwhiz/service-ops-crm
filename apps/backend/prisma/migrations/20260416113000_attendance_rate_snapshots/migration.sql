ALTER TABLE "object_attendance_facts"
ADD COLUMN "dailyRateSnapshot" INTEGER;

UPDATE "object_attendance_facts" AS attendance
SET "dailyRateSnapshot" = object."dailyRate"
FROM "objects" AS object
WHERE object."id" = attendance."objectId";

ALTER TABLE "object_attendance_facts"
ALTER COLUMN "dailyRateSnapshot" SET NOT NULL;
