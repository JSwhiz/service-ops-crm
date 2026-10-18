ALTER TABLE "objects"
  ADD COLUMN "paymentScheduleCycleStartDate" DATE,
  ADD COLUMN "summerScheduleCycleStartDate" DATE,
  ADD COLUMN "winterScheduleCycleStartDate" DATE;

ALTER TABLE "object_employee_assignments"
  ADD COLUMN "ratePolicyScheduleCycleStartDate" DATE;

ALTER TABLE "object_compensation_rates"
  ADD COLUMN "scheduleCycleStartDate" DATE;

-- Existing N/7-N schedules were interpreted as the first N weekdays of each
-- Monday-based week. Anchoring the new repeating cycle on Monday 2000-01-03
-- preserves that exact weekly interpretation for existing records.
UPDATE "objects"
SET "paymentScheduleCycleStartDate" = DATE '2000-01-03'
WHERE "paymentScheduleCode" IN ('1/6', '2/5', '3/4', '4/3', '6/1', '7/0')
  AND cardinality("paymentScheduleWeekdays") = 0;

UPDATE "objects"
SET "summerScheduleCycleStartDate" = DATE '2000-01-03'
WHERE "summerScheduleCode" IN ('1/6', '2/5', '3/4', '4/3', '6/1', '7/0')
  AND cardinality("summerScheduleWeekdays") = 0;

UPDATE "objects"
SET "winterScheduleCycleStartDate" = DATE '2000-01-03'
WHERE "winterScheduleCode" IN ('1/6', '2/5', '3/4', '4/3', '6/1', '7/0')
  AND cardinality("winterScheduleWeekdays") = 0;

UPDATE "object_compensation_rates"
SET "scheduleCycleStartDate" = DATE '2000-01-03'
WHERE "scheduleCode" IN ('1/6', '2/5', '3/4', '4/3', '6/1', '7/0')
  AND cardinality("scheduleWeekdays") = 0;

UPDATE "object_employee_assignments"
SET "ratePolicyScheduleCycleStartDate" = DATE '2000-01-03'
WHERE "ratePolicyScheduleCode" IN ('1/6', '2/5', '3/4', '4/3', '6/1', '7/0')
  AND cardinality("ratePolicyWeekdays") = 0;

-- Historically, explicit weekday picks overrode the saved template. Canonicalize
-- those records to the weekday mode without changing which dates are counted.
UPDATE "objects"
SET "paymentScheduleCode" = NULL,
    "paymentScheduleCycleStartDate" = NULL
WHERE cardinality("paymentScheduleWeekdays") > 0;

UPDATE "objects"
SET "summerScheduleCode" = NULL,
    "summerScheduleCycleStartDate" = NULL
WHERE cardinality("summerScheduleWeekdays") > 0;

UPDATE "objects"
SET "winterScheduleCode" = NULL,
    "winterScheduleCycleStartDate" = NULL
WHERE cardinality("winterScheduleWeekdays") > 0;

UPDATE "object_compensation_rates"
SET "scheduleCode" = NULL,
    "scheduleCycleStartDate" = NULL
WHERE cardinality("scheduleWeekdays") > 0;

UPDATE "object_employee_assignments"
SET "ratePolicyScheduleCode" = NULL,
    "ratePolicyScheduleCycleStartDate" = NULL
WHERE cardinality("ratePolicyWeekdays") > 0;
