import { fetcher } from '@/shared/api/fetcher';

import type {
  CreateTaskPayload,
  TaskHistoryEvent,
  TaskItem,
  TaskListQuery,
  TaskListResponse,
  UpdateTaskPayload,
} from '../model/task.types';

function buildTaskQuery(query: TaskListQuery): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  }

  return params.toString() ? `?${params.toString()}` : '';
}

export async function listTasks(
  query: TaskListQuery = {},
): Promise<TaskListResponse> {
  const response = await fetcher<TaskItem[] | TaskListResponse>(
    `/tasks${buildTaskQuery(query)}`,
    { method: 'GET' },
  );

  return Array.isArray(response)
    ? {
        items: response,
        page: 1,
        limit: response.length,
        total: response.length,
        totalPages: 1,
      }
    : response;
}

export async function getTaskById(id: string): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}`, { method: 'GET' });
}

export async function createTask(payload: CreateTaskPayload): Promise<TaskItem> {
  return fetcher<TaskItem>('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  id: string,
  payload: UpdateTaskPayload,
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function createTaskCompletionDraft(
  id: string,
): Promise<{ id: string; workCycle: number }> {
  return fetcher(`/tasks/${id}/assignees/me/completion-draft`, {
    method: 'POST',
  });
}

export async function completeTaskAssignment(
  id: string,
  payload: { completionId?: string; completionText?: string },
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/assignees/me/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function undoTaskCompletion(id: string): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/assignees/me/undo-completion`, {
    method: 'POST',
  });
}

export async function addTaskAssignees(
  id: string,
  userIds: string[],
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/assignees`, {
    method: 'POST',
    body: JSON.stringify({ userIds }),
  });
}

export async function removeTaskAssignee(
  id: string,
  userId: string,
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/assignees/${userId}`, {
    method: 'DELETE',
  });
}

async function runTaskAction(
  id: string,
  action: string,
  reason?: string,
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/${action}`, {
    method: 'POST',
    ...(reason ? { body: JSON.stringify({ reason }) } : {}),
  });
}

export const confirmTask = (id: string): Promise<TaskItem> =>
  runTaskAction(id, 'confirm');
export const completeTaskNow = (id: string): Promise<TaskItem> =>
  runTaskAction(id, 'complete-now');
export const returnTaskToWork = (id: string, reason: string): Promise<TaskItem> =>
  runTaskAction(id, 'return-to-work', reason);
export const reopenTask = (id: string, reason: string): Promise<TaskItem> =>
  runTaskAction(id, 'reopen', reason);
export const cancelTask = (id: string, reason: string): Promise<TaskItem> =>
  runTaskAction(id, 'cancel', reason);

export async function listTaskHistory(id: string): Promise<TaskHistoryEvent[]> {
  return fetcher<TaskHistoryEvent[]>(`/tasks/${id}/history`, { method: 'GET' });
}

export async function listTasksByObject(objectId: string): Promise<TaskItem[]> {
  return fetcher<TaskItem[]>(`/objects/${objectId}/tasks`, { method: 'GET' });
}

export async function listTasksByOneTimeOrder(
  oneTimeOrderId: string,
): Promise<TaskItem[]> {
  return fetcher<TaskItem[]>(`/one-time-orders/${oneTimeOrderId}/tasks`, {
    method: 'GET',
  });
}
