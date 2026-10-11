CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_outbox_notificationId_key"
ON "notification_outbox"("notificationId");

ALTER TABLE "notification_outbox"
ADD CONSTRAINT "notification_outbox_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "notifications"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notification_outbox_publishedAt_claimedAt_createdAt_idx"
ON "notification_outbox"("publishedAt", "claimedAt", "createdAt");
