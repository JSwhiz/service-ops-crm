import { fetcher } from '@/shared/api/fetcher';
import { getAccessToken } from '@/shared/auth/auth-storage';

import type { ServiceObject } from '../model/object.types';

export async function listObjects(): Promise<ServiceObject[]> {
  return fetcher<ServiceObject[]>('/objects', {
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
