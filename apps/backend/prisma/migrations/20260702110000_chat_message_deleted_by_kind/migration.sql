ALTER TABLE "chat_messages"
ADD COLUMN "deletedByKind" TEXT;

UPDATE "chat_messages"
SET "deletedByKind" = CASE
  WHEN "deletedByUserId" = "authorUserId" THEN 'author'
  WHEN "deletedByUserId" IS NOT NULL THEN 'manager'
  ELSE NULL
END
WHERE "deletedAt" IS NOT NULL;
