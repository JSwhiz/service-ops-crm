export function getTaskStatusLabel(status: string): string {
  switch (status) {
    case 'assigned':
      return 'Назначена';
    case 'in_progress':
      return 'В работе';
    case 'partially_completed':
      return 'Частично выполнена';
    case 'awaiting_confirmation':
      return 'Ожидает подтверждения';
    case 'returned_to_work':
      return 'Возвращена в работу';
    case 'closed':
      return 'Закрыта';
    default:
      return status;
  }
}

export function getTaskPriorityLabel(priority: string): string {
  switch (priority) {
    case 'urgent_important':
      return 'Срочно / важно';
    case 'urgent_not_important':
      return 'Срочно / неважно';
    case 'important_not_urgent':
      return 'Несрочно / важно';
    case 'not_important_not_urgent':
      return 'Несрочно / неважно';
    default:
      return priority;
  }
}

export const TASK_STATUS_OPTIONS = [
  { value: 'assigned', label: 'Назначена' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'partially_completed', label: 'Частично выполнена' },
  { value: 'awaiting_confirmation', label: 'Ожидает подтверждения' },
  { value: 'returned_to_work', label: 'Возвращена в работу' },
  { value: 'closed', label: 'Закрыта' },
] as const;

export const TASK_PRIORITY_OPTIONS = [
  { value: 'urgent_important', label: 'Срочно / важно' },
  { value: 'urgent_not_important', label: 'Срочно / неважно' },
  { value: 'important_not_urgent', label: 'Несрочно / важно' },
  { value: 'not_important_not_urgent', label: 'Несрочно / неважно' },
] as const;
