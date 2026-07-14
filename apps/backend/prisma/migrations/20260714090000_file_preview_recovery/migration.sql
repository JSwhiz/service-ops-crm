ALTER TABLE "file_derivatives"
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX "file_derivatives_status_processingStartedAt_idx"
ON "file_derivatives"("status", "processingStartedAt");
