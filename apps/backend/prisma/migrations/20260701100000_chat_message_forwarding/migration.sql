ALTER TABLE "chat_messages"
ADD COLUMN "forwardedFromMessageId" TEXT;

CREATE INDEX "chat_messages_forwardedFromMessageId_idx"
ON "chat_messages"("forwardedFromMessageId");

ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_forwardedFromMessageId_fkey"
FOREIGN KEY ("forwardedFromMessageId") REFERENCES "chat_messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
