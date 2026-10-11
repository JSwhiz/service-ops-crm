-- Engineering is an object-wide service requirement, not a summer-only flag.
-- Renaming preserves every value already entered in the former summer field.
ALTER TABLE "objects"
  RENAME COLUMN "summerEngineering" TO "engineeringRequired";
