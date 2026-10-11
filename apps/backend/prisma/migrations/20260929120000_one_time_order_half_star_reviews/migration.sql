ALTER TABLE "one_time_orders"
  ALTER COLUMN "reviewRating" TYPE DOUBLE PRECISION USING "reviewRating"::DOUBLE PRECISION;

ALTER TABLE "one_time_orders"
  DROP CONSTRAINT "one_time_orders_reviewRating_check",
  ADD CONSTRAINT "one_time_orders_reviewRating_check"
    CHECK (
      "reviewRating" IS NULL
      OR (
        "reviewRating" BETWEEN 1 AND 5
        AND "reviewRating" * 2 = TRUNC("reviewRating" * 2)
      )
    );
