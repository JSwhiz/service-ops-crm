import { fetcher } from '@/shared/api/fetcher';

import type { CreateTaskPayload, TaskItem } from '../model/task.types';

export async function listTasks(query?: {
  status?: string;
  objectId?: string;
  oneTimeOrderId?: string;
  assignedToMe?: boolean;
  search?: string;
}): Promise<TaskItem[]> {
  const params = new URLSearchParams();

  if (query?.status) {
    params.set('status', query.status);
  }
  if (query?.objectId) {
    params.set('objectId', query.objectId);
  }
  if (query?.oneTimeOrderId) {
    params.set('oneTimeOrderId', query.oneTimeOrderId);
  }
  if (query?.assignedToMe) {
    params.set('assignedToMe', 'true');
  }
  if (query?.search) {
    params.set('search', query.search);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';

  return fetcher<TaskItem[]>(`/tasks${suffix}`, {
    method: 'GET',
  });
}

export async function getTaskById(id: string): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}`, {
    method: 'GET',
  });
}

export async function createTask(payload: CreateTaskPayload): Promise<TaskItem> {
  return fetcher<TaskItem>('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTaskStatus(
  id: string,
  status: string,
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function submitTaskResult(
  id: string,
  resultText: string,
): Promise<TaskItem> {
  return fetcher<TaskItem>(`/tasks/${id}/result`, {
    method: 'POST',
    body: JSON.stringify({ resultText }),
  });
}

export async function listTasksByObject(objectId: string): Promise<TaskItem[]> {
  return fetcher<TaskItem[]>(`/objects/${objectId}/tasks`, {
    method: 'GET',
  });
}

export async function listTasksByOneTimeOrder(
  oneTimeOrderId: string,
): Promise<TaskItem[]> {
  return fetcher<TaskItem[]>(`/one-time-orders/${oneTimeOrderId}/tasks`, {
    method: 'GET',
  });
}
