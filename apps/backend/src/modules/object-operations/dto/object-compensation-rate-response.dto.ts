export class ObjectCompensationRateResponseDto {
  id!: string;
  objectId!: string;
  name!: string;
  category!: 'standard' | 'substitution';
  ratePolicyType!: 'daily_rate' | 'monthly_fixed';
  baseAmount!: number;
  scheduleCode!: string | null;
  scheduleWeekdays!: string[];
  scheduleCycleStartDate!: string | null;
  standardShiftHours!: number;
  notes!: string | null;
  isActive!: boolean;
  effectiveFrom!: string;
  effectiveTo!: string | null;
  updatedAt!: string;
}
