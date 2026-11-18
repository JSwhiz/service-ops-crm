import { committedWrite, fetcher } from '@/shared/api/fetcher';
import type { SavedWithoutAccess } from '@/shared/api/saved-without-access';
export type SubstitutionMutationResponse = SubstitutionList | SavedWithoutAccess;

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
export interface SubstitutionCapabilities { canCreate: boolean; canCreateForOthers: boolean }
export interface SubstitutionList { items: UserSubstitution[]; page: number; total: number; totalPages: number; capabilities: SubstitutionCapabilities }
export interface SubstitutionOptions { users: SubstitutionUser[]; objects: SubstitutionObject[]; eligibleSelectedObjectIds: string[]; principals: SubstitutionUser[]; resultLimit: number; capabilities: SubstitutionCapabilities }

export function listUserSubstitutions(page = 1): Promise<SubstitutionList> {
  return fetcher(`/user-substitutions?page=${page}&limit=20`);
}
export function getSubstitutionOptions(query: { principalUserId?: string; principalSearch?: string; userSearch?: string; objectSearch?: string; selectedObjectIds?: string[] } = {}): Promise<SubstitutionOptions> {
  const params = new URLSearchParams();
  if (query.principalUserId) params.set('principalUserId', query.principalUserId);
  if (query.principalSearch) params.set('principalSearch', query.principalSearch.slice(0, 100));
  if (query.userSearch) params.set('userSearch', query.userSearch);
  if (query.objectSearch) params.set('objectSearch', query.objectSearch);
  if (query.selectedObjectIds?.length) params.set('selectedObjectIds', query.selectedObjectIds.join(','));
  return fetcher(`/user-substitutions/options?${params}`);
}
export function createUserSubstitution(payload: { principalUserId?: string; replacementUserId: string; objectIds: string[]; startsAt: string; endsAt: string; reason: string }): Promise<SubstitutionMutationResponse> {
  return committedWrite<SubstitutionList>('/user-substitutions', { method: 'POST', body: JSON.stringify(payload) });
}
export function revokeUserSubstitution(id: string, reason: string): Promise<SubstitutionMutationResponse> {
  return committedWrite<SubstitutionList>(`/user-substitutions/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
}
