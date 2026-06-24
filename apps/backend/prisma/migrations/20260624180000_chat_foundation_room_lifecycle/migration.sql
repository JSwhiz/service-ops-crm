ALTER TABLE "chat_rooms"
  ADD COLUMN "directKey" TEXT,
  ADD COLUMN "deletedByUserId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deleteReason" TEXT;

ALTER TABLE "chat_room_participants"
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "leftAt" TIMESTAMP(3);

UPDATE "chat_rooms"
SET "roomType" = 'system_default'
WHERE "code" IS NOT NULL;

UPDATE "chat_rooms"
SET "roomType" = 'group'
WHERE "code" IS NULL
  AND "roomType" = 'custom';

CREATE UNIQUE INDEX "chat_rooms_directKey_key" ON "chat_rooms"("directKey");
CREATE INDEX "chat_rooms_deletedByUserId_idx" ON "chat_rooms"("deletedByUserId");
CREATE INDEX "chat_rooms_deletedAt_idx" ON "chat_rooms"("deletedAt");
CREATE INDEX "chat_room_participants_hiddenAt_idx" ON "chat_room_participants"("hiddenAt");
CREATE INDEX "chat_room_participants_leftAt_idx" ON "chat_room_participants"("leftAt");

ALTER TABLE "chat_rooms"
  ADD CONSTRAINT "chat_rooms_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
