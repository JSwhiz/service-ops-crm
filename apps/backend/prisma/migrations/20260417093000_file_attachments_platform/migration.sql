ALTER TABLE "files"
ADD CONSTRAINT "files_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "file_attachments" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldCode" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "file_attachments_fileId_idx" ON "file_attachments"("fileId");
CREATE INDEX "file_attachments_entityType_entityId_idx" ON "file_attachments"("entityType", "entityId");
CREATE INDEX "file_attachments_uploadedByUserId_idx" ON "file_attachments"("uploadedByUserId");

ALTER TABLE "file_attachments"
ADD CONSTRAINT "file_attachments_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "files"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "file_attachments"
ADD CONSTRAINT "file_attachments_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
