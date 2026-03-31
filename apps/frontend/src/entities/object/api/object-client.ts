import { fetcher } from '@/shared/api/fetcher';
import { getAccessToken } from '@/shared/auth/auth-storage';

import type { ServiceObject } from '../model/object.types';

export interface ListObjectsQuery {
  search?: string;
  status?: string;
}

export async function listObjects(
  query?: ListObjectsQuery,
): Promise<ServiceObject[]> {
  const params = new URLSearchParams();

  if (query?.search) {
    params.set('search', query.search);
  }

  if (query?.status) {
    params.set('status', query.status);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';

  return fetcher<ServiceObject[]>(`/objects${suffix}`, {
    method: 'GET',
    token: getAccessToken(),
  });
}

export async function getObjectById(id: string): Promise<ServiceObject> {
  return fetcher<ServiceObject>(`/objects/${id}`, {
    method: 'GET',
    token: getAccessToken(),
  });
}

export async function createObject(payload: {
  name: string;
  internalName?: string;
  address: string;
  status?: string;
  seasonMode?: string;
  dailyRate?: number;
  notes?: string;
}): Promise<ServiceObject> {
  return fetcher<ServiceObject>('/objects', {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}
