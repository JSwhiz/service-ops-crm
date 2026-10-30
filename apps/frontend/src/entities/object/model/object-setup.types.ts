export type SetupBudgetCategory = 'payroll' | 'consumables_cleaning' | 'consumables_household' | 'windows' | 'taxi' | 'tractor' | 'carpets' | 'deep_cleaning' | 'waste_removal' | 'equipment' | 'other';
export type SetupBudgetPeriod = 'monthly' | 'annual' | 'once' | 'per_occurrence';
export interface SetupBudget {
  category: SetupBudgetCategory; amount: number | null; period: SetupBudgetPeriod;
  monthlyAllocation: (number | null)[] | null; plannedOccurrences: number | null; notes: string | null;
  targetMonth: string | null; label: string | null;
}
export interface ObjectSetupData {
  legalName: string | null; areaSqM: number | null; plannedLaunchDate: string | null;
  contractStartsOn: string | null; contractEndsOn: string | null; contractMonthlyAmount: number | null;
  salesResponsibleUserId: string | null; coefficient: number | null; budgets: SetupBudget[] | null;
}
export interface SetupCapabilities {
  canEditCore: boolean; canViewContractAmount: boolean; canEditContractAmount: boolean;
  canViewBudgets: boolean; canEditBudgets: boolean; canViewCoefficient: boolean; canEditCoefficient: boolean;
}
export interface ObjectSetupResponse {
  objectId: string; version: number; data: ObjectSetupData; capabilities: SetupCapabilities;
  budgets: { month: string; consumablesActualAmount: number | null; consumablesSource: string;
    rows: { category: SetupBudgetCategory; planAmount: number | null; actualAmount: number | null; source: string }[] };
}
