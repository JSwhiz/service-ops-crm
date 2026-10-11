ALTER TABLE "objects"
  ADD COLUMN "masterForCounterpartyId" TEXT;

ALTER TABLE "objects"
  ADD CONSTRAINT "objects_masterForCounterpartyId_fkey"
  FOREIGN KEY ("masterForCounterpartyId") REFERENCES "counterparties"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "objects"
  ADD CONSTRAINT "objects_master_for_counterparty_matches_link"
  CHECK (
    "masterForCounterpartyId" IS NULL
    OR "masterForCounterpartyId" = "counterpartyId"
  );

CREATE UNIQUE INDEX "objects_masterForCounterpartyId_key"
  ON "objects"("masterForCounterpartyId");
