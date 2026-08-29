import { fetcher } from '@/shared/api/fetcher';
import type { CandidateArchiveState, CandidateCard, CandidateListResponse, CandidateSlaState, CandidateStatus, CandidateType, CandidateUserSummary } from '../model/candidate.types';

function queryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function listCandidates(params: { q?: string; candidateType?: CandidateType; status?: CandidateStatus; managerUserId?: string; slaState?: CandidateSlaState; archiveState?: CandidateArchiveState; page?: number; limit?: number; sort?: string; sortDirection?: 'asc' | 'desc' }): Promise<CandidateListResponse> {
  return fetcher(`/candidates${queryString(params)}`);
}
export function listCandidateManagers(params: { q?: string; selectedId?: string } = {}): Promise<CandidateUserSummary[]> { return fetcher(`/candidates/references/managers${queryString(params)}`); }
export function getCandidate(id: string): Promise<CandidateCard> { return fetcher(`/candidates/${id}`); }
export function createCandidate(payload: { fullName: string; phone?: string; comment?: string; candidateType: CandidateType }): Promise<CandidateCard> { return fetcher('/candidates', { method: 'POST', body: JSON.stringify(payload) }); }
export function updateCandidate(id: string, payload: { expectedVersion: number; fullName?: string; phone?: string | null; comment?: string | null; candidateType?: CandidateType }): Promise<CandidateCard> { return fetcher(`/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export function changeCandidateStatus(id: string, status: CandidateStatus, expectedVersion: number): Promise<CandidateCard> { return fetcher(`/candidates/${id}/status`, { method: 'POST', body: JSON.stringify({ status, expectedVersion }) }); }
export function setCandidateArchive(id: string, expectedVersion: number, restore = false): Promise<CandidateCard> { return fetcher(`/candidates/${id}/${restore ? 'restore' : 'archive'}`, { method: 'POST', body: JSON.stringify({ expectedVersion }) }); }
export function assignCandidateManager(id: string, managerUserId: string, expectedVersion: number): Promise<CandidateCard> { return fetcher(`/candidates/${id}/assignments`, { method: 'POST', body: JSON.stringify({ managerUserId, expectedVersion }) }); }
export function addCandidateResponse(id: string, text: string): Promise<CandidateCard> { return fetcher(`/candidates/${id}/responses`, { method: 'POST', body: JSON.stringify({ text }) }); }
