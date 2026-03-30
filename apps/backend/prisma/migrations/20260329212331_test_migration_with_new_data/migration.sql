-- CreateTable
CREATE TABLE "objects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalName" TEXT,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "seasonMode" TEXT NOT NULL DEFAULT 'summer',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_assignments" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentRoleCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_arrival_photos" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "photoType" TEXT,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_arrival_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_daily_reports" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_comments" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "commentType" TEXT NOT NULL DEFAULT 'manual',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "objects_status_idx" ON "objects"("status");

-- CreateIndex
CREATE INDEX "objects_createdByUserId_idx" ON "objects"("createdByUserId");

-- CreateIndex
CREATE INDEX "object_assignments_objectId_idx" ON "object_assignments"("objectId");

-- CreateIndex
CREATE INDEX "object_assignments_userId_idx" ON "object_assignments"("userId");

-- CreateIndex
CREATE INDEX "object_assignments_assignmentRoleCode_idx" ON "object_assignments"("assignmentRoleCode");

-- CreateIndex
CREATE UNIQUE INDEX "object_assignments_objectId_userId_assignmentRoleCode_key" ON "object_assignments"("objectId", "userId", "assignmentRoleCode");

-- CreateIndex
CREATE INDEX "object_arrival_photos_objectId_operationDate_idx" ON "object_arrival_photos"("objectId", "operationDate");

-- CreateIndex
CREATE UNIQUE INDEX "object_arrival_photos_objectId_operationDate_key" ON "object_arrival_photos"("objectId", "operationDate");

-- CreateIndex
CREATE INDEX "object_daily_reports_objectId_reportDate_idx" ON "object_daily_reports"("objectId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "object_daily_reports_objectId_reportDate_key" ON "object_daily_reports"("objectId", "reportDate");

-- CreateIndex
CREATE INDEX "object_comments_objectId_createdAt_idx" ON "object_comments"("objectId", "createdAt");

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_assignments" ADD CONSTRAINT "object_assignments_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_assignments" ADD CONSTRAINT "object_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_arrival_photos" ADD CONSTRAINT "object_arrival_photos_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_arrival_photos" ADD CONSTRAINT "object_arrival_photos_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_daily_reports" ADD CONSTRAINT "object_daily_reports_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_daily_reports" ADD CONSTRAINT "object_daily_reports_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_comments" ADD CONSTRAINT "object_comments_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_comments" ADD CONSTRAINT "object_comments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
