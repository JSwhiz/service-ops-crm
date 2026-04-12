import { fetcher } from '@/shared/api/fetcher';
import { getAccessToken } from '@/shared/auth/auth-storage';

import type { ServiceObject } from '../model/object.types';

export interface ListObjectsParams {
  search?: string;
  status?: string;
}

export interface CreateObjectPayload {
  name: string;
  internalName: string;
  address: string;
  status: string;
  seasonMode: string;
  dailyRate: number;
  notes?: string;
  managerUserIds?: string[];
}

export interface UpdateObjectPayload {
  name?: string;
  internalName?: string;
  address?: string;
  status?: string;
  seasonMode?: string;
  dailyRate?: number;
  notes?: string;
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
    token: getAccessToken(),
  });
}

export async function getObjectById(objectId: string): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${objectId}`, {
    method: 'GET',
    token: getAccessToken(),
  });
}

export async function createObject(
  payload: CreateObjectPayload,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>('/objects', {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}

export async function updateObject(
  objectId: string,
  payload: UpdateObjectPayload,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${objectId}`, {
    method: 'PATCH',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}

export async function changeObjectStatus(
  objectId: string,
  payload: ChangeObjectStatusPayload,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${objectId}/status`, {
    method: 'PATCH',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}

export async function addResponsibleToObject(
  objectId: string,
  userId: string,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/objects/${objectId}/responsibles`, {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify({ userId }),
  });
}

export async function removeResponsibleFromObject(
  objectId: string,
  userId: string,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(
    `/objects/${objectId}/responsibles/${userId}`,
    {
      method: 'DELETE',
      token: getAccessToken(),
    },
  );
}

export async function addManagerToObject(
  objectId: string,
  userId: string,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/objects/${objectId}/managers`, {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify({ userId }),
  });
}

export async function removeManagerFromObject(
  objectId: string,
  userId: string,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/objects/${objectId}/managers/${userId}`, {
    method: 'DELETE',
    token: getAccessToken(),
  });
}
