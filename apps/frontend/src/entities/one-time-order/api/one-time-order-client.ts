import { fetcher } from '@/shared/api/fetcher';

import type {
  CreateOneTimeOrderPayload,
  OneTimeOrderCommentItem,
  OneTimeOrderDailyReportItem,
  OneTimeOrderHistoryItem,
  OneTimeOrderItem,
  OneTimeOrderPhotoItem,
  OneTimeOrderSpecificationItem,
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

export async function updateOneTimeOrderReview(
  id: string,
  payload: { reviewText: string | null; reviewRating: number | null },
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function clearOneTimeOrderReview(
  id: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/review`, {
    method: 'DELETE',
  });
}

export async function listOneTimeOrderSpecificationItems(
  id: string,
): Promise<OneTimeOrderSpecificationItem[]> {
  return fetcher<OneTimeOrderSpecificationItem[]>(
    `/one-time-orders/${id}/specification-items`,
    { method: 'GET' },
  );
}

export async function createOneTimeOrderSpecificationItem(
  id: string,
  payload: {
    title: string;
    description?: string;
    requiresAttachment?: boolean;
  },
): Promise<OneTimeOrderSpecificationItem> {
  return fetcher<OneTimeOrderSpecificationItem>(
    `/one-time-orders/${id}/specification-items`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function updateOneTimeOrderSpecificationItem(
  id: string,
  itemId: string,
  payload: {
    title?: string;
    description?: string | null;
    requiresAttachment?: boolean;
    reopenCompleted?: boolean;
  },
): Promise<OneTimeOrderSpecificationItem> {
  return fetcher<OneTimeOrderSpecificationItem>(
    `/one-time-orders/${id}/specification-items/${itemId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

export async function deleteOneTimeOrderSpecificationItem(
  id: string,
  itemId: string,
): Promise<OneTimeOrderSpecificationItem> {
  return fetcher<OneTimeOrderSpecificationItem>(
    `/one-time-orders/${id}/specification-items/${itemId}`,
    { method: 'DELETE' },
  );
}

export async function completeOneTimeOrderSpecificationItem(
  id: string,
  itemId: string,
): Promise<OneTimeOrderSpecificationItem> {
  return fetcher<OneTimeOrderSpecificationItem>(
    `/one-time-orders/${id}/specification-items/${itemId}/complete`,
    { method: 'POST' },
  );
}

export async function reopenOneTimeOrderSpecificationItem(
  id: string,
  itemId: string,
): Promise<OneTimeOrderSpecificationItem> {
  return fetcher<OneTimeOrderSpecificationItem>(
    `/one-time-orders/${id}/specification-items/${itemId}/reopen`,
    { method: 'POST' },
  );
}

export async function reorderOneTimeOrderSpecificationItems(
  id: string,
  itemIds: string[],
): Promise<OneTimeOrderSpecificationItem[]> {
  return fetcher<OneTimeOrderSpecificationItem[]>(
    `/one-time-orders/${id}/specification-items/reorder`,
    { method: 'PATCH', body: JSON.stringify({ itemIds }) },
  );
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

export async function getTodayOneTimeOrderDailyReport(
  id: string,
): Promise<OneTimeOrderDailyReportItem | null> {
  return fetcher<OneTimeOrderDailyReportItem | null>(
    `/one-time-orders/${id}/daily-report/today`,
    {
      method: 'GET',
    },
  );
}

export async function upsertTodayOneTimeOrderDailyReport(
  id: string,
  payload: {
    content: string;
  },
): Promise<OneTimeOrderDailyReportItem> {
  return fetcher<OneTimeOrderDailyReportItem>(
    `/one-time-orders/${id}/daily-report/today`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
}

export async function listOneTimeOrderPhotos(
  id: string,
  options?: { includeDeleted?: boolean },
): Promise<OneTimeOrderPhotoItem[]> {
  const query = options?.includeDeleted ? '?includeDeleted=true' : '';
  return fetcher<OneTimeOrderPhotoItem[]>(
    `/one-time-orders/${id}/photos${query}`,
    {
      method: 'GET',
    },
  );
}

export async function createOneTimeOrderPhoto(
  id: string,
  payload: {
    category: string;
    comment?: string;
  },
): Promise<OneTimeOrderPhotoItem> {
  return fetcher<OneTimeOrderPhotoItem>(`/one-time-orders/${id}/photos`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteOneTimeOrderPhoto(
  id: string,
  photoId: string,
  reason?: string,
): Promise<OneTimeOrderPhotoItem> {
  return fetcher<OneTimeOrderPhotoItem>(
    `/one-time-orders/${id}/photos/${photoId}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function restoreOneTimeOrderPhoto(
  id: string,
  photoId: string,
): Promise<OneTimeOrderPhotoItem> {
  return fetcher<OneTimeOrderPhotoItem>(
    `/one-time-orders/${id}/photos/${photoId}/restore`,
    { method: 'POST' },
  );
}
