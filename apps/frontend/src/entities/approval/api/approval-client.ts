import { fetcher } from '@/shared/api/fetcher';

import type {
  ApprovalRequestItem,
  ListApprovalRequestsParams,
} from '../model/approval.types';

function buildQuery(params?: ListApprovalRequestsParams): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      continue;
    }

    searchParams.set(key, value);
  }

  const query = searchParams.toString();

  return query ? `?${query}` : '';
}

export async function listApprovalRequests(
  params?: ListApprovalRequestsParams,
): Promise<ApprovalRequestItem[]> {
  return fetcher<ApprovalRequestItem[]>(`/approvals${buildQuery(params)}`, {
    method: 'GET',
  });
}

export async function approveApprovalRequest(
  id: string,
  comment?: string,
): Promise<ApprovalRequestItem> {
  return fetcher<ApprovalRequestItem>(`/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(comment?.trim() ? { comment } : {}),
  });
}

export async function rejectApprovalRequest(
  id: string,
  comment: string,
): Promise<ApprovalRequestItem> {
  return fetcher<ApprovalRequestItem>(`/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export async function cancelApprovalRequest(
  id: string,
  comment?: string,
): Promise<ApprovalRequestItem> {
  return fetcher<ApprovalRequestItem>(`/approvals/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify(comment?.trim() ? { comment } : {}),
  });
}
