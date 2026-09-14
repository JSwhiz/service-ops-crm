import { fetcher } from '@/shared/api/fetcher';

import type {
  CounterpartyCard,
  CounterpartyHistoryItem,
  CounterpartyListResponse,
  CounterpartyReference,
} from '../model/counterparty.types';

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function listCounterparties(params: {
  q?: string;
  status?: 'active' | 'archived' | 'all';
  page?: number;
  limit?: number;
} = {}): Promise<CounterpartyListResponse> {
  return fetcher(`/counterparties${queryString(params)}`);
}

export function listCounterpartyReferences(params: {
  q?: string;
  selectedId?: string;
  limit?: number;
} = {}): Promise<CounterpartyReference[]> {
  return fetcher(`/counterparties/references${queryString(params)}`);
}

export function getCounterparty(id: string): Promise<CounterpartyCard> {
  return fetcher(`/counterparties/${id}`);
}

export function listCounterpartyHistory(
  id: string,
): Promise<CounterpartyHistoryItem[]> {
  return fetcher(`/counterparties/${id}/history`);
}

export function createCounterparty(payload: {
  name: string;
  legalName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}): Promise<CounterpartyCard> {
  return fetcher('/counterparties', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCounterparty(
  id: string,
  payload: {
    name?: string;
    legalName?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    notes?: string | null;
  },
): Promise<CounterpartyCard> {
  return fetcher(`/counterparties/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setCounterpartyArchived(
  id: string,
  archived: boolean,
): Promise<CounterpartyCard> {
  return fetcher(`/counterparties/${id}/${archived ? 'archive' : 'restore'}`, {
    method: 'POST',
  });
}

export function linkCounterpartyObject(
  id: string,
  objectId: string,
): Promise<CounterpartyCard> {
  return fetcher(`/counterparties/${id}/objects/${objectId}`, {
    method: 'POST',
  });
}

export function unlinkCounterpartyObject(
  id: string,
  objectId: string,
): Promise<CounterpartyCard> {
  return fetcher(`/counterparties/${id}/objects/${objectId}`, {
    method: 'DELETE',
  });
}
