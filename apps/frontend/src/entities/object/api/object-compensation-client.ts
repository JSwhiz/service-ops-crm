import { fetcher } from '@/shared/api/fetcher';
import type { CompensationAdjustmentInput, CompensationExplanation, CompensationMutationResult, CompensationTerms, CompensationVersion, CorrectExtraWorkInput, ObjectCompensation, TeamFundAllocation, TeamFundVersion } from '../model/object-compensation.types';

const base = (id: string): string => `/objects/${id}/scheduling/compensation`;
export const getObjectCompensation = (id: string): Promise<ObjectCompensation> => fetcher(base(id));
export const createCompensationVersion = (id: string, input: {
  requestKey: string; scope: CompensationVersion['scope']; scopeId?: string; effectiveFrom: string; expectedVersion: number; terms: CompensationTerms;
}): Promise<{ status: 'applied'; version: CompensationVersion }> => fetcher(`${base(id)}/versions`, { method: 'POST', body: JSON.stringify(input) });
export const cancelCompensationVersion = (id: string, versionId: string, input: { expectedVersion: number; reason: string }): Promise<{ status: 'applied'; version: CompensationVersion }> => fetcher(`${base(id)}/versions/${versionId}/cancel`, { method: 'POST', body: JSON.stringify(input) });
export const createTeamFund = (id: string, input: {
  requestKey: string; effectiveFrom: string; expectedVersion: number; monthlyAmount: number; allocations: TeamFundAllocation[]; reason: string;
}): Promise<{ status: 'applied'; teamFund: TeamFundVersion }> => fetcher(`${base(id)}/team-funds`, { method: 'POST', body: JSON.stringify(input) });
export const adjustObjectCompensation = (id: string, input: CompensationAdjustmentInput): Promise<CompensationMutationResult> => fetcher(`${base(id)}/adjustments`, { method: 'POST', body: JSON.stringify(input) });
export const correctExtraWork = (id: string, adjustmentId: string, input: CorrectExtraWorkInput): Promise<CompensationMutationResult> => fetcher(`${base(id)}/adjustments/${adjustmentId}/correct`, { method: 'POST', body: JSON.stringify(input) });
export const getCompensationExplanation = (id: string, year: number, month: number): Promise<CompensationExplanation> => fetcher(`${base(id)}/explanation?${new URLSearchParams({ year: String(year), month: String(month) })}`);
