export const TASK_STATUSES = [
  'in_progress',
  'awaiting_confirmation',
  'pending_auto_close',
  'completed',
  'cancelled',
  // Accepted temporarily by compatibility endpoints until lifecycle migration completes.
  'assigned',
  'partially_completed',
  'returned_to_work',
  'closed',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [
  'urgent_important',
  'urgent_not_important',
  'important_not_urgent',
  'not_important_not_urgent',
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
