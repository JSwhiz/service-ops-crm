ALTER TABLE "one_time_order_completions"
    ADD COLUMN "completionSource" TEXT NOT NULL DEFAULT 'native';

ALTER TABLE "one_time_order_completions"
    ADD CONSTRAINT "one_time_order_completions_source_check"
    CHECK ("completionSource" IN ('native', 'legacy_unknown'));

-- Mark only rows with the exact deterministic identity produced by the old
-- backfill. Rows with financial descendants remain present and auditable.
UPDATE "one_time_order_completions" AS completion
SET "completionSource" = 'legacy_unknown'
WHERE completion."id" = md5(
        'legacy-one-time-order-completion:' || completion."oneTimeOrderId"
    )
  AND completion."workCycle" = 1
  AND completion."completionComment" = 'Legacy completion backfill';

-- The old migration copied operational timestamps and creator identity into
-- completion facts. They are unknown, including when financial descendants
-- require the technical completion row to be retained.
UPDATE "one_time_orders" AS one_time_order
SET
    "completedAt" = NULL,
    "completedByUserId" = NULL
WHERE EXISTS (
    SELECT 1
    FROM "one_time_order_completions" AS completion
    WHERE completion."oneTimeOrderId" = one_time_order."id"
      AND completion."completionSource" = 'legacy_unknown'
);

-- Delete only untouched technical rows with no financial provenance. Any
-- modified or financially referenced row remains as legacy_unknown.
DELETE FROM "one_time_order_completions" AS completion
WHERE completion."completionSource" = 'legacy_unknown'
  AND completion."status" = 'active'
  AND completion."clientRequestId" IS NULL
  AND completion."payloadFingerprint" IS NULL
  AND completion."createdAt" = completion."completedAt"
  AND completion."updatedAt" = completion."completedAt"
  AND NOT EXISTS (
      SELECT 1
      FROM "one_time_order_completion_payments" AS payment
      WHERE payment."completionId" = completion."id"
  )
  AND NOT EXISTS (
      SELECT 1
      FROM "accountability_fundings" AS funding
      WHERE funding."oneTimeOrderCompletionId" = completion."id"
  )
  AND NOT EXISTS (
      SELECT 1
      FROM "accountability_expenses" AS expense
      WHERE expense."oneTimeOrderCompletionId" = completion."id"
  );
