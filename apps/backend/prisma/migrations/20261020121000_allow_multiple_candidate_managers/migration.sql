-- Replace the legacy one-manager-per-candidate invariant with the per-manager
-- partial unique index introduced by candidates_hr_workflow.
DROP INDEX "candidate_manager_assignments_one_active_idx";
