-- Fixed agreed compensation for an employee in a specific one-time-order work cycle.
-- This is intentionally separate from Employee.baseDailyRate and daily attendance snapshots.
ALTER TABLE "one_time_order_employee_assignments"
  ADD COLUMN "orderPayment" DECIMAL(14,2);
