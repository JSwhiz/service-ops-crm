ALTER TABLE "chat_messages"
ADD COLUMN "replyToMessageId" TEXT;

CREATE INDEX "chat_messages_replyToMessageId_idx" ON "chat_messages"("replyToMessageId");

ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_replyToMessageId_fkey"
FOREIGN KEY ("replyToMessageId") REFERENCES "chat_messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
