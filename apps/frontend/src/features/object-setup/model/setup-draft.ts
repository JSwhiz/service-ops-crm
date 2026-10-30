import type { ObjectSetupData, SetupBudget, SetupBudgetCategory, SetupBudgetPeriod, SetupCapabilities } from '@/entities/object/model/object-setup.types';

export const budgetCategories: Record<SetupBudgetCategory, string> = {
  payroll: 'Зарплата', consumables_cleaning: 'Уборочные расходники', consumables_household: 'Хозяйственные расходники',
  windows: 'Мытьё окон', taxi: 'Такси', tractor: 'Трактор', carpets: 'Ковры', deep_cleaning: 'Генеральная уборка', waste_removal: 'Вывоз', equipment: 'Техника', other: 'Прочие расходы',
};
export const budgetPeriods: Record<SetupBudgetPeriod, string> = {
  monthly: 'В месяц', annual: 'В год', once: 'Разово', per_occurrence: 'За одно выполнение',
};
export interface BudgetDraft {
  category: SetupBudgetCategory; amount: string; period: SetupBudgetPeriod;
  monthlyAllocation: string[] | null; plannedOccurrences: string; notes: string;
  targetMonth: string; label: string;
}
export interface SetupDraft {
  legalName: string; areaSqM: string; plannedLaunchDate: string; contractStartsOn: string; contractEndsOn: string;
  contractMonthlyAmount: string; salesResponsibleUserId: string; coefficient: string; budgets: BudgetDraft[];
}
export function setupDraft(data?: ObjectSetupData): SetupDraft {
  return {
    legalName: data?.legalName ?? '', areaSqM: data?.areaSqM?.toString() ?? '', plannedLaunchDate: data?.plannedLaunchDate ?? '',
    contractStartsOn: data?.contractStartsOn ?? '', contractEndsOn: data?.contractEndsOn ?? '', contractMonthlyAmount: data?.contractMonthlyAmount?.toString() ?? '',
    salesResponsibleUserId: data?.salesResponsibleUserId ?? '', coefficient: data?.coefficient?.toString() ?? '',
    budgets: (data?.budgets ?? []).map((row) => ({ ...row, amount: row.amount?.toString() ?? '', monthlyAllocation: row.monthlyAllocation?.map((cell) => cell?.toString() ?? '') ?? null, plannedOccurrences: row.plannedOccurrences?.toString() ?? '', targetMonth: row.targetMonth ?? '', label: row.label ?? '', notes: row.notes ?? '' })),
  };
}
export function nullableNumber(value: string, label: string): number | null {
  if (value.trim() === '') return null;
  const result = Number(value.replace(',', '.'));
  if (!Number.isFinite(result) || result < 0) throw new Error(`Проверьте поле «${label}».`);
  return result;
}
export function setupPayload(value: SetupDraft, caps: SetupCapabilities): Partial<ObjectSetupData> {
  const result: Partial<ObjectSetupData> = {};
  if (caps.canEditCore) Object.assign(result, {
    legalName: value.legalName.trim() || null, areaSqM: nullableNumber(value.areaSqM, 'Площадь'),
    plannedLaunchDate: value.plannedLaunchDate || null, contractStartsOn: value.contractStartsOn || null,
    contractEndsOn: value.contractEndsOn || null, salesResponsibleUserId: value.salesResponsibleUserId || null,
  });
  if (caps.canEditContractAmount) result.contractMonthlyAmount = nullableNumber(value.contractMonthlyAmount, 'Сумма договора');
  if (caps.canEditCoefficient) result.coefficient = nullableNumber(value.coefficient, 'Коэффициент');
  if (caps.canEditBudgets) result.budgets = value.budgets.map((row): SetupBudget => ({
    category: row.category, amount: nullableNumber(row.amount, 'План бюджета'), period: row.period,
    monthlyAllocation: row.monthlyAllocation?.map((cell) => nullableNumber(cell, 'Распределение по месяцам')) ?? null,
    plannedOccurrences: nullableNumber(row.plannedOccurrences, 'Число выполнений'), notes: row.notes.trim() || null,
    targetMonth: row.period === 'once' ? row.targetMonth || null : null, label: row.label.trim() || null,
  }));
  return result;
}
