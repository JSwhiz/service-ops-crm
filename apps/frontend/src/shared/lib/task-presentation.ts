import type {
  TaskCompletionRequirement,
  TaskHistoryEvent,
} from '@/entities/task/model/task.types';
import { getUserDisplayName } from './display-name';

export function getTaskStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    in_progress: 'В работе',
    awaiting_confirmation: 'Ожидает подтверждения',
    pending_auto_close: 'Автозавершение',
    completed: 'Завершена',
    cancelled: 'Отменена',
    assigned: 'Назначена',
    partially_completed: 'Частично выполнена',
    returned_to_work: 'Возвращена в работу',
    closed: 'Закрыта',
  };
  return labels[status] ?? status;
}

export function getTaskPriorityLabel(priority: string): string {
  const labels: Record<string, string> = {
    urgent_important: 'Срочно / важно',
    urgent_not_important: 'Срочно / неважно',
    important_not_urgent: 'Несрочно / важно',
    not_important_not_urgent: 'Несрочно / неважно',
  };
  return labels[priority] ?? priority;
}

export function getCompletionRequirementLabel(
  requirement: TaskCompletionRequirement | string,
): string {
  const labels: Record<string, string> = {
    none: 'Без отчёта',
    comment_or_file: 'Комментарий или файл',
    comment_required: 'Комментарий обязателен',
    file_required: 'Файл обязателен',
  };
  return labels[requirement] ?? requirement;
}

export function formatTaskDeadline(
  dueAt: string | null,
  dueTimeSpecified: boolean,
): string {
  if (!dueAt) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    ...(dueTimeSpecified ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/Moscow',
  }).format(new Date(dueAt));
}

export function formatTaskHistoryEvent(event: TaskHistoryEvent): string {
  const actor = event.actor ? getUserDisplayName(event.actor) : 'Система';
  const labels: Record<string, string> = {
    'task.created': `${actor} создал(а) задачу`,
    'task.updated': `${actor} изменил(а) задачу`,
    'task.visibility_changed': `${actor} изменил(а) видимость`,
    'task.assignee_added': `${actor} добавил(а) исполнителя`,
    'task.assignee_removed': `${actor} удалил(а) исполнителя`,
    'task.assignee_completed': `${actor} отметил(а) свою часть выполненной`,
    'task.assignee_completion_cancelled': `${actor} отменил(а) выполнение`,
    'task.awaiting_confirmation': 'Задача ожидает подтверждения',
    'task.auto_close_scheduled': 'Запущен таймер автоматического завершения',
    'task.confirmed': `${actor} подтвердил(а) задачу`,
    'task.completed_manually': `${actor} завершил(а) задачу вручную`,
    'task.auto_closed': 'Задача завершена автоматически',
    'task.returned_to_work': `${actor} вернул(а) задачу в работу`,
    'task.reopened': `${actor} переоткрыл(а) задачу`,
    'task.cancelled': `${actor} отменил(а) задачу`,
  };
  return labels[event.eventType] ?? event.eventType;
}

export const TASK_STATUS_OPTIONS = [
  { value: 'in_progress', label: 'В работе' },
  { value: 'awaiting_confirmation', label: 'Ожидает подтверждения' },
  { value: 'pending_auto_close', label: 'Автозавершение' },
  { value: 'completed', label: 'Завершена' },
  { value: 'cancelled', label: 'Отменена' },
] as const;

export const TASK_PRIORITY_OPTIONS = [
  { value: 'urgent_important', label: 'Срочно / важно' },
  { value: 'urgent_not_important', label: 'Срочно / неважно' },
  { value: 'important_not_urgent', label: 'Несрочно / важно' },
  { value: 'not_important_not_urgent', label: 'Несрочно / неважно' },
] as const;

export const TASK_COMPLETION_OPTIONS = [
  { value: 'none', label: 'Без обязательного отчёта' },
  { value: 'comment_or_file', label: 'Комментарий или файл' },
  { value: 'comment_required', label: 'Комментарий обязателен' },
  { value: 'file_required', label: 'Файл обязателен' },
] as const;
