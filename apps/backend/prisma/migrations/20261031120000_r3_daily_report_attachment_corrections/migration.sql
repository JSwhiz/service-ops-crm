ALTER TABLE "object_daily_report_publications"
ADD COLUMN "attachmentSnapshot" JSONB,
ADD COLUMN "attachmentDiff" JSONB,
ADD COLUMN "correctionReason" TEXT;

CREATE TABLE "object_daily_report_attachment_stages" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_daily_report_attachment_stages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "object_daily_report_attachment_stages_fileId_key" ON "object_daily_report_attachment_stages"("fileId");
CREATE UNIQUE INDEX "object_daily_report_attachment_stages_reportId_actorUserId_requestId_key" ON "object_daily_report_attachment_stages"("reportId", "actorUserId", "requestId");
CREATE INDEX "object_daily_report_attachment_stages_objectId_reportId_idx" ON "object_daily_report_attachment_stages"("objectId", "reportId");
ALTER TABLE "object_daily_report_attachment_stages" ADD CONSTRAINT "object_daily_report_attachment_stages_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "object_daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_daily_report_attachment_stages" ADD CONSTRAINT "object_daily_report_attachment_stages_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_daily_report_attachment_stages" ADD CONSTRAINT "object_daily_report_attachment_stages_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "object_daily_report_attachment_stages" ADD CONSTRAINT "object_daily_report_attachment_stages_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "object_daily_report_attachment_requests" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_daily_report_attachment_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "object_daily_report_attachment_requests_reportId_actorUserId_requestId_key" ON "object_daily_report_attachment_requests"("reportId", "actorUserId", "requestId");
CREATE INDEX "object_daily_report_attachment_requests_reportId_createdAt_idx" ON "object_daily_report_attachment_requests"("reportId", "createdAt");
ALTER TABLE "object_daily_report_attachment_requests" ADD CONSTRAINT "object_daily_report_attachment_requests_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "object_daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_daily_report_attachment_requests" ADD CONSTRAINT "object_daily_report_attachment_requests_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
