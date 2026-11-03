/** Contract: backend object-scheduling/compensation.dto.ts and compensation service. */
export interface CompensationTerms {
  ratePolicyType: 'daily_rate' | 'monthly_fixed';
  baseAmount: number;
  summerAmount?: number | null;
  winterAmount?: number | null;
  scheduleCode?: string | null;
  scheduleWeekdays?: string[];
  scheduleCycleStartDate?: string | null;
  paidHolidays?: boolean;
  notes?: string;
}
export interface CompensationVersion {
  id: string; scope: 'defaults' | 'contour' | 'rate'; scopeId: string; version: number;
  effectiveFrom: string; terms: CompensationTerms; createdByUserId: string; createdAt: string;
  cancelledAt: string | null; cancelReason: string | null;
  createdBy?: { id: string; fullName: string } | null;
}
export interface TeamFundAllocation { positionId: string; contourId: string; monthlyAmount: number }
export interface TeamFundVersion {
  id: string; version: number; effectiveFrom: string; monthlyAmount: number;
  allocations: TeamFundAllocation[]; reason: string; createdByUserId: string; createdAt: string;
  createdBy?: { id: string; fullName: string } | null;
}
export type AdjustmentKind = 'extra_work' | 'shift_override' | 'replacement' | 'holiday_exception';
export interface CompensationAdjustmentInput {
  requestKey: string; kind: AdjustmentKind; operationDate: string; reason: string;
  employeeId?: string; attendanceId?: string; expectedVersion?: number; amount?: number;
  replacementEmployeeId?: string; substitutionId?: string; paid?: boolean;
  contourId?: string | null;
}
export interface CorrectExtraWorkInput { requestKey: string; expectedCreditUpdatedAt: string; amount: number; reason: string }
export interface CompensationMutationResult {
  status: 'applied' | 'pending' | 'rejected' | 'cancelled'; adjustmentId: string; approvalRequestId: string | null;
}
export interface CompensationAdjustment {
  id: string; kind: string; operationDate: string; status: string; reason: string;
  employeeId: string | null; createdByUserId: string; createdAt: string;
  beforeSnapshot: Record<string, unknown>; afterSnapshot: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  createdBy?: { id: string; fullName: string } | null;
  appliedBy?: { id: string; fullName: string } | null;
  beforeAmount?: number | null; afterAmount?: number | null; difference?: number | null;
  currentAmount?: number | null; creditUpdatedAt?: string | null;
}
export interface ObjectCompensation {
  versions: CompensationVersion[]; teamFunds: TeamFundVersion[]; adjustments: CompensationAdjustment[];
  capabilities: { manageRates: boolean; manageTeamFund: boolean; requestExtraWork: boolean; requestAdjustment: boolean; approveRetroactive: boolean };
}
export interface SalaryHalfExplanation {
  half: 1 | 2; baseHalf: number; normDays: number | null; paidDays: number; holidayDays: number;
  amount: number | null; unavailableReason: string | null; compensationVersionId: string;
  poolKey: string | null; savedAmount: number;
}
export interface CompensationExplanation {
  objectId: string; year: number; month: number; calculationVersion: string; unavailableReason: string | null;
  rows: {
    employeeId: string; employeeName: string; explanations: SalaryHalfExplanation[];
    entries: { id: string; operationDate: string; amount: number; explanation: string; sourceKey: string; updatedAt: string }[];
    advanceTotal: number; salaryTotal: number;
  }[];
}
