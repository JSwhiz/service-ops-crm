ALTER TABLE "one_time_order_completions"
    ALTER COLUMN "completedAt" DROP NOT NULL,
    ALTER COLUMN "completedByUserId" DROP NOT NULL;

UPDATE "one_time_order_completions"
SET
    "completedAt" = NULL,
    "completedByUserId" = NULL,
    "completionComment" = NULL
WHERE "completionSource" = 'legacy_unknown';

ALTER TABLE "one_time_order_completions"
    ADD CONSTRAINT "one_time_order_completions_facts_check"
    CHECK (
        ("completionSource" = 'native'
            AND "completedAt" IS NOT NULL
            AND "completedByUserId" IS NOT NULL)
        OR
        ("completionSource" = 'legacy_unknown'
            AND "completedAt" IS NULL
            AND "completedByUserId" IS NULL)
    );

CREATE OR REPLACE FUNCTION reconcile_one_time_order_completion_current_state()
RETURNS void AS $$
BEGIN
    UPDATE "one_time_orders" AS one_time_order
    SET
        "completedAt" = CASE
            WHEN one_time_order."status" = 'completed' THEN (
                SELECT completion."completedAt"
                FROM "one_time_order_completions" AS completion
                WHERE completion."oneTimeOrderId" = one_time_order."id"
                  AND completion."workCycle" = one_time_order."workCycle"
                  AND completion."status" = 'active'
                  AND completion."completionSource" = 'native'
                LIMIT 1
            )
            ELSE NULL
        END,
        "completedByUserId" = CASE
            WHEN one_time_order."status" = 'completed' THEN (
                SELECT completion."completedByUserId"
                FROM "one_time_order_completions" AS completion
                WHERE completion."oneTimeOrderId" = one_time_order."id"
                  AND completion."workCycle" = one_time_order."workCycle"
                  AND completion."status" = 'active'
                  AND completion."completionSource" = 'native'
                LIMIT 1
            )
            ELSE NULL
        END;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION reconcile_one_time_order_completion_current_state() FROM PUBLIC;

SELECT reconcile_one_time_order_completion_current_state();
