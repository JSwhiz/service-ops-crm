export const TASK_STATUSES = [
  'assigned',
  'in_progress',
  'partially_completed',
  'awaiting_confirmation',
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
