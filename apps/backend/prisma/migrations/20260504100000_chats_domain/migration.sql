CREATE TABLE "chat_rooms" (
  "id" TEXT NOT NULL,
  "code" TEXT,
  "title" TEXT NOT NULL,
  "roomType" TEXT NOT NULL,
  "visibilityType" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "lastMessagePreview" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_room_participants" (
  "id" TEXT NOT NULL,
  "chatRoomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleInRoom" TEXT NOT NULL DEFAULT 'member',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_room_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
  "id" TEXT NOT NULL,
  "chatRoomId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "messageType" TEXT NOT NULL,
  "text" TEXT,
  "metadata" JSONB,
  "editedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_rooms_code_key" ON "chat_rooms"("code");
CREATE INDEX "chat_rooms_roomType_idx" ON "chat_rooms"("roomType");
CREATE INDEX "chat_rooms_visibilityType_idx" ON "chat_rooms"("visibilityType");
CREATE INDEX "chat_rooms_lastMessageAt_idx" ON "chat_rooms"("lastMessageAt");
CREATE INDEX "chat_rooms_createdByUserId_idx" ON "chat_rooms"("createdByUserId");

CREATE UNIQUE INDEX "chat_room_participants_chatRoomId_userId_key" ON "chat_room_participants"("chatRoomId", "userId");
CREATE INDEX "chat_room_participants_chatRoomId_idx" ON "chat_room_participants"("chatRoomId");
CREATE INDEX "chat_room_participants_userId_idx" ON "chat_room_participants"("userId");
CREATE INDEX "chat_room_participants_roleInRoom_idx" ON "chat_room_participants"("roleInRoom");

CREATE INDEX "chat_messages_chatRoomId_createdAt_idx" ON "chat_messages"("chatRoomId", "createdAt");
CREATE INDEX "chat_messages_authorUserId_idx" ON "chat_messages"("authorUserId");
CREATE INDEX "chat_messages_messageType_idx" ON "chat_messages"("messageType");

ALTER TABLE "chat_rooms"
  ADD CONSTRAINT "chat_rooms_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_room_participants"
  ADD CONSTRAINT "chat_room_participants_chatRoomId_fkey"
  FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_room_participants"
  ADD CONSTRAINT "chat_room_participants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_chatRoomId_fkey"
  FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
