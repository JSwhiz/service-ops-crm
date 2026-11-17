-- AlterTable
ALTER TABLE "chat_room_participants" ADD COLUMN     "membershipOverride" TEXT;

-- AlterTable
ALTER TABLE "objects" ADD COLUMN     "windowCleaningMode" TEXT,
ADD COLUMN     "windowCleaningSeasons" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "accountability_expenses" ADD COLUMN     "clientRequestId" TEXT;

-- CreateTable
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authSessionId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "vapidPublicKey" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_deliveries" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "notificationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "finishedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_userId_disabledAt_idx" ON "web_push_subscriptions"("userId", "disabledAt");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_authSessionId_idx" ON "web_push_subscriptions"("authSessionId");

-- CreateIndex
CREATE INDEX "web_push_deliveries_status_nextAttemptAt_claimedAt_idx" ON "web_push_deliveries"("status", "nextAttemptAt", "claimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_deliveries_subscriptionId_notificationId_key" ON "web_push_deliveries"("subscriptionId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "accountability_expenses_createdByUserId_clientRequestId_key" ON "accountability_expenses"("createdByUserId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "web_push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_deliveries" ADD CONSTRAINT "web_push_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

