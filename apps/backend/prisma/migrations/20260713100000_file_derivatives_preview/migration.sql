CREATE TABLE "file_derivatives" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "derivativeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objectKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_derivatives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "file_derivatives_fileId_derivativeType_key"
ON "file_derivatives"("fileId", "derivativeType");

CREATE INDEX "file_derivatives_fileId_idx" ON "file_derivatives"("fileId");
CREATE INDEX "file_derivatives_status_idx" ON "file_derivatives"("status");

ALTER TABLE "file_derivatives"
ADD CONSTRAINT "file_derivatives_fileId_fkey"
FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
