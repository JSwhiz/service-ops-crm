-- Candidate -> Object is an explicit domain relation.
-- Existing rows remain nullable because legacy data cannot be backfilled safely.
ALTER TABLE "candidates"
  ADD COLUMN "objectId" TEXT;

ALTER TABLE "candidates"
  ADD CONSTRAINT "candidates_objectId_fkey"
  FOREIGN KEY ("objectId")
  REFERENCES "objects"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "candidates_objectId_idx" ON "candidates"("objectId");
