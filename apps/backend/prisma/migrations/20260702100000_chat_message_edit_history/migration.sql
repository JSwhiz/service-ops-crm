CREATE TABLE "chat_message_edit_history" (
  "id" TEXT NOT NULL,
  "chatMessageId" TEXT NOT NULL,
  "editedByUserId" TEXT NOT NULL,
  "oldText" TEXT,
  "newText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_edit_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_message_edit_history_chatMessageId_idx"
ON "chat_message_edit_history"("chatMessageId");
CREATE INDEX "chat_message_edit_history_editedByUserId_idx"
ON "chat_message_edit_history"("editedByUserId");
CREATE INDEX "chat_message_edit_history_createdAt_idx"
ON "chat_message_edit_history"("createdAt");

ALTER TABLE "chat_message_edit_history"
ADD CONSTRAINT "chat_message_edit_history_chatMessageId_fkey"
FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_message_edit_history"
ADD CONSTRAINT "chat_message_edit_history_editedByUserId_fkey"
FOREIGN KEY ("editedByUserId") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
