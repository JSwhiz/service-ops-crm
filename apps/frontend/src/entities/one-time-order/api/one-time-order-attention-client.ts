import { fetcher } from '@/shared/api/fetcher';

export interface OneTimeOrderAttentionItem {
  id: string;
  title: string;
  status: string;
  executionStartDate: string | null;
  executionEndDate: string | null;
  executionAddress: string;
  linkedObject: { id: string; name: string } | null;
  managers: Array<{ userId: string; login: string; fullName: string }>;
}

export interface OneTimeOrderAttentionResponse {
  items: OneTimeOrderAttentionItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listOneTimeOrderAttention(params: {
  q?: string;
  managerUserId?: string;
  linkedObjectId?: string;
  page?: number;
  limit?: number;
} = {}): Promise<OneTimeOrderAttentionResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return fetcher<OneTimeOrderAttentionResponse>(`/one-time-orders/attention${suffix ? `?${suffix}` : ''}`, { method: 'GET' });
}
