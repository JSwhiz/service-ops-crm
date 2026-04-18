import { fetcher } from '@/shared/api/fetcher';

import type {
  CreateOneTimeOrderPayload,
  OneTimeOrderCommentItem,
  OneTimeOrderHistoryItem,
  OneTimeOrderItem,
  UpdateOneTimeOrderPayload,
} from '../model/one-time-order.types';

interface ListOneTimeOrdersParams {
  search?: string;
  status?: string;
}

function buildQuery(params?: ListOneTimeOrdersParams): string {
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

export async function listOneTimeOrders(
  params?: ListOneTimeOrdersParams,
): Promise<OneTimeOrderItem[]> {
  return fetcher<OneTimeOrderItem[]>(
    `/one-time-orders${buildQuery(params)}`,
    {
      method: 'GET',
    },
  );
}

export async function getOneTimeOrderById(id: string): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}`, {
    method: 'GET',
  });
}

export async function createOneTimeOrder(
  payload: CreateOneTimeOrderPayload,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>('/one-time-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateOneTimeOrder(
  id: string,
  payload: UpdateOneTimeOrderPayload,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function changeOneTimeOrderStatus(
  id: string,
  status: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function assignOneTimeOrderManager(
  id: string,
  userId: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/managers`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export async function removeOneTimeOrderManager(
  id: string,
  userId: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/managers/${userId}`, {
    method: 'DELETE',
  });
}

export async function listOneTimeOrderComments(
  id: string,
): Promise<OneTimeOrderCommentItem[]> {
  return fetcher<OneTimeOrderCommentItem[]>(`/one-time-orders/${id}/comments`, {
    method: 'GET',
  });
}

export async function createOneTimeOrderComment(
  id: string,
  payload: {
    content: string;
    commentType?: string;
  },
): Promise<OneTimeOrderCommentItem> {
  return fetcher<OneTimeOrderCommentItem>(`/one-time-orders/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listOneTimeOrderHistory(
  id: string,
): Promise<OneTimeOrderHistoryItem[]> {
  return fetcher<OneTimeOrderHistoryItem[]>(`/one-time-orders/${id}/history`, {
    method: 'GET',
  });
}
