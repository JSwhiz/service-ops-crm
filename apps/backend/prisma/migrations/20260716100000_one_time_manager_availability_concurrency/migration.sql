DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "one_time_manager_availability"
    WHERE "status" = 'pending'
    GROUP BY "userId", "entryType", "startDate", "endDate"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add pending availability uniqueness: exact pending duplicates exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "one_time_manager_availability" left_entry
    JOIN "one_time_manager_availability" right_entry
      ON left_entry."userId" = right_entry."userId"
     AND left_entry."id" < right_entry."id"
     AND left_entry."status" = 'approved'
     AND right_entry."status" = 'approved'
     AND daterange(left_entry."startDate", left_entry."endDate", '[]')
       && daterange(right_entry."startDate", right_entry."endDate", '[]')
  ) THEN
    RAISE EXCEPTION 'Cannot add approved availability exclusion: overlapping approved entries exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "one_time_manager_availability_pending_exact_key"
  ON "one_time_manager_availability"(
    "userId",
    "entryType",
    "startDate",
    "endDate"
  )
  WHERE "status" = 'pending';

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "one_time_manager_availability"
  ADD CONSTRAINT "one_time_manager_availability_approved_no_overlap"
  EXCLUDE USING gist (
    "userId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  )
  WHERE ("status" = 'approved');
