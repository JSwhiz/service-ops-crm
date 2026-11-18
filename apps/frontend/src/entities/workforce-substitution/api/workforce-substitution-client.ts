import { fetcher } from '@/shared/api/fetcher';

export interface WorkforceSubstitution {
  id: string;
  employeeName: string;
  substituteEmployeeName: string;
  startDate: string;
  endDate: string | null;
  status: string;
  object: { id: string; name: string; canView: boolean };
}
export interface WorkforceSubstitutionPage {
  items: WorkforceSubstitution[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface WorkforceSubstitutionQuery {
  page: number;
  limit: number;
  q: string;
  from: string;
  to: string;
  objectId?: string;
}
export function listWorkforceSubstitutions(query: WorkforceSubstitutionQuery, signal?: AbortSignal): Promise<WorkforceSubstitutionPage> {
  const params = new URLSearchParams({ page: String(query.page), limit: String(query.limit) });
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.objectId) params.set('objectId', query.objectId);
  return fetcher(`/workforce-substitutions?${params}`, { signal });
}
