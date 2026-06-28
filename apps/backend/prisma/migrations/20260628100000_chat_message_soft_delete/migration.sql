ALTER TABLE "chat_messages"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT,
ADD COLUMN "deleteReason" TEXT;

CREATE INDEX "chat_messages_deletedByUserId_idx" ON "chat_messages"("deletedByUserId");
CREATE INDEX "chat_messages_deletedAt_idx" ON "chat_messages"("deletedAt");

ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_deletedByUserId_fkey"
FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
