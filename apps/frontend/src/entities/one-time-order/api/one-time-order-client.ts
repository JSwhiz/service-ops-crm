import { fetcher } from '@/shared/api/fetcher';
import { refreshSession } from '@/shared/auth/auth-session';
import { appConfig } from '@/shared/config/app-config';

import type {
  CreateOneTimeOrderPayload,
  CompleteOneTimeOrderPayload,
  CorrectOneTimeOrderPaymentPayload,
  OneTimeOrderCommentItem,
  OneTimeOrderDailyReportItem,
  OneTimeOrderHistoryItem,
  OneTimeManagerAvailability,
  OneTimeOrderAvailabilityType,
  OneTimeOrderCalendarResponse,
  OneTimeOrderConflictResponse,
  OneTimeOrderItem,
  OneTimeOrderCompletion,
  OneTimeOrderListResponse,
  OneTimeOrderPhotoItem,
  OneTimeOrderSpecificationItem,
  UpdateOneTimeOrderPayload,
} from '../model/one-time-order.types';

export type OneTimeOrderSortField =
  | 'title'
  | 'executionStartDate'
  | 'status'
  | 'createdAt'
  | 'updatedAt';

export interface ListOneTimeOrdersParams {
  q?: string;
  search?: string;
  status?: string;
  managerUserId?: string;
  linkedObjectId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: OneTimeOrderSortField;
  sortDirection?: 'asc' | 'desc';
}

function buildQuery(params?: ListOneTimeOrdersParams): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();

  return query ? `?${query}` : '';
}

export async function listOneTimeOrders(
  params?: ListOneTimeOrdersParams,
): Promise<OneTimeOrderListResponse> {
  return fetcher<OneTimeOrderListResponse>(
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

export async function listOneTimeOrderCompletions(
  id: string,
): Promise<OneTimeOrderCompletion[]> {
  return fetcher<OneTimeOrderCompletion[]>(`/one-time-orders/${id}/completions`, {
    method: 'GET',
  });
}

export async function completeOneTimeOrder(
  id: string,
  payload: CompleteOneTimeOrderPayload,
): Promise<OneTimeOrderCompletion> {
  return fetcher<OneTimeOrderCompletion>(`/one-time-orders/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function reopenOneTimeOrder(
  id: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/reopen`, {
    method: 'POST',
  });
}

export async function correctOneTimeOrderPayment(
  orderId: string,
  paymentId: string,
  payload: CorrectOneTimeOrderPaymentPayload,
): Promise<OneTimeOrderCompletion> {
  return fetcher<OneTimeOrderCompletion>(
    `/one-time-orders/${orderId}/payments/${paymentId}/correct`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
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
  conflictFingerprint?: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, conflictFingerprint }),
  });
}

export async function assignOneTimeOrderManager(
  id: string,
  userId: string,
  conflictFingerprint?: string,
): Promise<OneTimeOrderItem> {
  return fetcher<OneTimeOrderItem>(`/one-time-orders/${id}/managers`, {
    method: 'POST',
    body: JSON.stringify({ userId, conflictFingerprint }),
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

export async function getOneTimeOrderCalendar(params: {
  month: string;
  managerUserId?: string;
}): Promise<OneTimeOrderCalendarResponse> {
  return fetcher<OneTimeOrderCalendarResponse>(
    `/one-time-orders/calendar${buildQuery(params)}`,
    { method: 'GET' },
  );
}

export async function downloadOneTimeOrderCalendarExcel(params: {
  month: string;
  managerUserId?: string;
  status?: string;
  includeCancelled?: boolean;
}): Promise<Blob> {
  const path = `/one-time-orders/calendar/export.xlsx${buildQuery(params)}`;
  const request = (): Promise<Response> =>
    fetch(`${appConfig.apiUrl}${path}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
  let response = await request();

  if (response.status === 401 && (await refreshSession())) {
    response = await request();
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GET ${path} failed with status ${response.status}${body ? `: ${body}` : ''}`,
    );
  }

  return response.blob();
}

export async function checkOneTimeOrderConflicts(payload: {
  executionStartDate: string;
  executionEndDate: string;
  managerUserIds: string[];
  excludeOrderId?: string;
}): Promise<OneTimeOrderConflictResponse> {
  return fetcher<OneTimeOrderConflictResponse>(
    '/one-time-orders/calendar/check-conflicts',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function createOwnOneTimeManagerAvailability(payload: {
  entryType: OneTimeOrderAvailabilityType;
  startDate: string;
  endDate: string;
  comment?: string;
}): Promise<OneTimeManagerAvailability> {
  return fetcher<OneTimeManagerAvailability>(
    '/one-time-orders/calendar/availability-requests',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function createDirectOneTimeManagerAvailability(payload: {
  userId: string;
  entryType: OneTimeOrderAvailabilityType;
  startDate: string;
  endDate: string;
  comment?: string;
}): Promise<OneTimeManagerAvailability> {
  return fetcher<OneTimeManagerAvailability>(
    '/one-time-orders/calendar/availability/direct',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function approveOneTimeManagerAvailability(
  id: string,
  comment?: string,
): Promise<OneTimeManagerAvailability> {
  return fetcher<OneTimeManagerAvailability>(
    `/one-time-orders/calendar/availability/${id}/approve`,
    { method: 'POST', body: JSON.stringify({ comment }) },
  );
}

export async function rejectOneTimeManagerAvailability(
  id: string,
  comment: string,
): Promise<OneTimeManagerAvailability> {
  return fetcher<OneTimeManagerAvailability>(
    `/one-time-orders/calendar/availability/${id}/reject`,
    { method: 'POST', body: JSON.stringify({ comment }) },
  );
}

export async function cancelOneTimeManagerAvailability(
  id: string,
): Promise<OneTimeManagerAvailability> {
  return fetcher<OneTimeManagerAvailability>(
    `/one-time-orders/calendar/availability/${id}/cancel`,
    { method: 'POST' },
  );
}

export async function updateOneTimeManagerAvailability(
  id: string,
  payload: {
    entryType?: OneTimeOrderAvailabilityType;
    startDate?: string;
    endDate?: string;
    comment?: string;
  },
): Promise<OneTimeManagerAvailability> {
  return fetcher<OneTimeManagerAvailability>(
    `/one-time-orders/calendar/availability/${id}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}
