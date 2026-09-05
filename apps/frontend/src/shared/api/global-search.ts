import { fetcher } from '@/shared/api/fetcher';

export type GlobalSearchEntityType =
  | 'object'
  | 'one_time_order'
  | 'task'
  | 'employee'
  | 'candidate';

export interface GlobalSearchItem {
  id: string;
  type: GlobalSearchEntityType;
  label: string;
  description: string | null;
  href: string;
}

export interface GlobalSearchResponse {
  query: string;
  items: GlobalSearchItem[];
}

export interface GlobalSearchRecentRef {
  type: GlobalSearchEntityType;
  id: string;
}

export async function globalSearch(
  query: string,
  limit = 5,
): Promise<GlobalSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return fetcher<GlobalSearchResponse>(`/search?${params.toString()}`, {
    method: 'GET',
  });
}

export async function resolveGlobalSearchRecent(
  refs: GlobalSearchRecentRef[],
): Promise<GlobalSearchItem[]> {
  if (refs.length === 0) return [];
  return fetcher<GlobalSearchItem[]>('/search/recent', {
    method: 'POST',
    body: JSON.stringify({ refs }),
  });
}
