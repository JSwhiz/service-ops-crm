/*
  Warnings:

  - You are about to drop the column `attendanceStatus` on the `timesheet_day_entries` table. All the data in the column will be lost.
  - You are about to drop the column `note` on the `timesheet_day_entries` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "timesheet_day_entries" DROP COLUMN "attendanceStatus",
DROP COLUMN "note",
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "dayValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isChangedManually" BOOLEAN NOT NULL DEFAULT false;
