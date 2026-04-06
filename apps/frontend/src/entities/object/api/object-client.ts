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

export interface ObjectEmployeeOption {
  id: string;
  fullName: string;
}

export interface UpsertObjectAttendancePayload {
  operationDate: string;
  employeeIds: string[];
  comment?: string;
}

function buildObjectsQuery(params?: ListObjectsParams): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();

  if (params.search?.trim()) {
    searchParams.set('search', params.search.trim());
  }

  if (params.status?.trim()) {
    searchParams.set('status', params.status.trim());
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

export async function listObjectEmployees(
  objectId: string,
): Promise<ObjectEmployeeOption[]> {
  return fetcher<ObjectEmployeeOption[]>(`/objects/${objectId}/employees`, {
    method: 'GET',
    token: getAccessToken(),
  });
}

export async function upsertObjectAttendance(
  objectId: string,
  payload: UpsertObjectAttendancePayload,
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/objects/${objectId}/attendance`, {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}
