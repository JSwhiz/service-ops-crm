ALTER TABLE "one_time_order_completion_payments"
DROP CONSTRAINT "one_time_order_completion_payments_status_check";

ALTER TABLE "one_time_order_completion_payments"
ADD CONSTRAINT "one_time_order_completion_payments_status_check"
CHECK ("status" IN ('active', 'reversed', 'reversal'));
