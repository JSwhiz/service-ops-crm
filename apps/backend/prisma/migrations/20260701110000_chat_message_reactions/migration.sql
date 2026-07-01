CREATE TABLE "chat_message_reactions" (
  "id" TEXT NOT NULL,
  "chatMessageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reactionType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_message_reactions_chatMessageId_userId_reactionType_key"
ON "chat_message_reactions"("chatMessageId", "userId", "reactionType");
CREATE INDEX "chat_message_reactions_chatMessageId_idx"
ON "chat_message_reactions"("chatMessageId");
CREATE INDEX "chat_message_reactions_userId_idx"
ON "chat_message_reactions"("userId");

ALTER TABLE "chat_message_reactions"
ADD CONSTRAINT "chat_message_reactions_chatMessageId_fkey"
FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_message_reactions"
ADD CONSTRAINT "chat_message_reactions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
