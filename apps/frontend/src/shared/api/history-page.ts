export interface HistoryActor {
  id: string;
  login: string;
  fullName: string;
}

export interface HistoryPageFacets {
  actors: HistoryActor[];
  eventTypes: string[];
  actorsHasMore: boolean;
  eventTypesHasMore: boolean;
}

export interface HistoryPageResponse<TItem> {
  items: TItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  facets: HistoryPageFacets;
}

export interface HistoryPageQuery {
  page?: number;
  limit?: number;
  eventType?: string;
  actorUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  actorSearch?: string;
}

export function historyPageQueryString(params: HistoryPageQuery): string {
  const query = new URLSearchParams();
  for (const key of ['page', 'limit', 'eventType', 'actorUserId', 'dateFrom', 'dateTo', 'q', 'actorSearch'] as const) {
    const value = params[key];
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}
