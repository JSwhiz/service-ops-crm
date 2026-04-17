import { TaskStatus } from '../types/task-status.type';

interface TaskTransitionContext {
  currentStatus: TaskStatus;
  isWideAccess: boolean;
  isCreator: boolean;
  isAssignee: boolean;
}

const ASSIGNEE_STATUSES: TaskStatus[] = ['in_progress', 'partially_completed'];
const WIDE_WORKFLOW_STATUSES: TaskStatus[] = [
  'assigned',
  'in_progress',
  'partially_completed',
  'returned_to_work',
];
const WIDE_CONFIRMATION_STATUSES: TaskStatus[] = ['returned_to_work', 'closed'];

export function getAllowedTaskStatusTransitions(
  context: TaskTransitionContext,
): TaskStatus[] {
  if (context.currentStatus === 'closed') {
    return [];
  }

  if (context.currentStatus === 'awaiting_confirmation') {
    return context.isWideAccess ? WIDE_CONFIRMATION_STATUSES : [];
  }

  const transitions = new Set<TaskStatus>();

  if (context.isWideAccess) {
    for (const status of WIDE_WORKFLOW_STATUSES) {
      if (status !== context.currentStatus) {
        transitions.add(status);
      }
    }
  }

  if (context.isCreator || context.isAssignee) {
    for (const status of ASSIGNEE_STATUSES) {
      if (status !== context.currentStatus) {
        transitions.add(status);
      }
    }
  }

  return Array.from(transitions);
}

export function canSubmitTaskResult(context: TaskTransitionContext): boolean {
  if (context.currentStatus === 'awaiting_confirmation') {
    return false;
  }

  if (context.currentStatus === 'closed') {
    return false;
  }

  return context.isWideAccess || context.isAssignee;
}
