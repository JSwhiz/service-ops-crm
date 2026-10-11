import { fetcher } from '@/shared/api/fetcher';

export interface SubstitutionUser { id: string; fullName: string; login: string }
export interface SubstitutionObject { id: string; name: string; archived?: boolean }
export interface UserSubstitution {
  id: string;
  principal: SubstitutionUser;
  replacement: SubstitutionUser;
  createdBy: SubstitutionUser;
  revokedBy: SubstitutionUser | null;
  objects: SubstitutionObject[];
  startsAt: string;
  endsAt: string;
  reason: string;
  revocationReason: string | null;
  status: 'scheduled' | 'active' | 'expired' | 'revoked';
  canRevoke: boolean;
}
export interface SubstitutionList { items: UserSubstitution[]; page: number; total: number; totalPages: number }
export interface SubstitutionOptions { users: SubstitutionUser[]; objects: SubstitutionObject[]; resultLimit: number }

export function listUserSubstitutions(page = 1): Promise<SubstitutionList> {
  return fetcher(`/user-substitutions?page=${page}&limit=20`);
}
export function getSubstitutionOptions(query: { userSearch?: string; objectSearch?: string } = {}): Promise<SubstitutionOptions> {
  const params = new URLSearchParams();
  if (query.userSearch) params.set('userSearch', query.userSearch);
  if (query.objectSearch) params.set('objectSearch', query.objectSearch);
  return fetcher(`/user-substitutions/options?${params}`);
}
export function createUserSubstitution(payload: { replacementUserId: string; objectIds: string[]; startsAt: string; endsAt: string; reason: string }): Promise<SubstitutionList> {
  return fetcher('/user-substitutions', { method: 'POST', body: JSON.stringify(payload) });
}
export function revokeUserSubstitution(id: string, reason: string): Promise<SubstitutionList> {
  return fetcher(`/user-substitutions/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
}
