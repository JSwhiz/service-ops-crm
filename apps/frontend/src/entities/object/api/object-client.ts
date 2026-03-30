import { fetcher } from '@/shared/api/fetcher';
import { getAccessToken } from '@/shared/auth/auth-storage';

import type {
  CreateObjectPayload,
  ListObjectsQuery,
  ServiceObject,
} from '../model/object.types';

function buildQuery(query: ListObjectsQuery): string {
  const params = new URLSearchParams();

  if (query.search) {
    params.set('search', query.search);
  }

  if (query.status) {
    params.set('status', query.status);
  }

  const stringified = params.toString();
  return stringified ? `?${stringified}` : '';
}

export async function listObjects(
  query: ListObjectsQuery = {},
): Promise<ServiceObject[]> {
  return fetcher<ServiceObject[]>(`/objects${buildQuery(query)}`, {
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

export async function createObject(
  payload: CreateObjectPayload,
): Promise<ServiceObject> {
  return fetcher<ServiceObject>('/objects', {
    method: 'POST',
    token: getAccessToken(),
    body: JSON.stringify(payload),
  });
}
