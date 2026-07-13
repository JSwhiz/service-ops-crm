import { fetcher } from '@/shared/api/fetcher';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';

import type {
  ObjectAuditLogItem,
  ServiceObject,
} from '../model/object.types';

export interface ListObjectsParams {
  search?: string;
  status?: string;
}

export interface CreateObjectPayload {
  name: string;
  internalName: string;
  address: string;
  status: string;
  seasonMode: string | null;
  dailyRate: number;
  notes?: string;
  managerUserIds?: string[];
  responsibleUserId: string;
}

export interface UpdateObjectPayload {
  name?: string;
  internalName?: string;
  address?: string;
  status?: string;
  seasonMode?: string | null;
  dailyRate?: number;
  notes?: string;
  responsibleUserId?: string;
}

export interface ChangeObjectStatusPayload {
  status: string;
}

function buildObjectsQuery(params?: ListObjectsParams): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();

  if (params.search) {
    searchParams.set('search', params.search);
  }

  if (params.status) {
    searchParams.set('status', params.status);
  }

  const query = searchParams.toString();

  return query ? `?${query}` : '';
}

export async function listObjects(
  params?: ListObjectsParams,
): Promise<ServiceObject[]> {
  return fetcher<ServiceObject[]>(`/objects${buildObjectsQuery(params)}`, {
    method: 'GET',
  });
}

export async function getObjectById(id: string): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}`, {
    method: 'GET',
  });
}

export async function listObjectAuditLogs(
  id: string,
): Promise<ObjectAuditLogItem[]> {
  return fetcher<ObjectAuditLogItem[]>(`/objects/${id}/audit`, {
    method: 'GET',
  });
}

export async function createObject(
  payload: CreateObjectPayload,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>('/objects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateObject(
  id: string,
  payload: UpdateObjectPayload,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function changeObjectStatus(
  id: string,
  payload: ChangeObjectStatusPayload,
): Promise<ApprovalRequestItem> {
  return fetcher<ApprovalRequestItem>(`/objects/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function addResponsibleToObject(
  id: string,
  userId: string,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}/responsibles`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export async function removeResponsibleFromObject(
  id: string,
  userId: string,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}/responsibles/${userId}`, {
    method: 'DELETE',
  });
}

export async function addManagerToObject(
  id: string,
  userId: string,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}/managers`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export async function removeManagerFromObject(
  id: string,
  userId: string,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}/managers/${userId}`, {
    method: 'DELETE',
  });
}
