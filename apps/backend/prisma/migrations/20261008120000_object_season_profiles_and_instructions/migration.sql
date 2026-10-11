ALTER TABLE "objects"
  ADD COLUMN "summerWindowCleaning" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "summerEngineering" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "winterTractorMode" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "instructionSteps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "objects"
  ADD CONSTRAINT "objects_winterTractorMode_check"
  CHECK ("winterTractorMode" IN ('none', 'with_removal', 'without_removal'));
