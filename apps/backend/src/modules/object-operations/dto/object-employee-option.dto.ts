export class ObjectEmployeeOptionDto {
  id!: string;
  fullName!: string;
  position!: string | null;
  baseDailyRate!: number | null;
  workScheduleCode!: string | null;
  workScheduleCustom!: string | null;
  workTimeText!: string | null;
  isAssignedToObject!: boolean;
  ratePolicy!: {
    ratePolicyType: string;
    baseAmount: number;
    scheduleCode: string | null;
    roundingMode: string;
    roundingStep: number | null;
    standardShiftHours: number;
    workingDaysInMonth: number | null;
    excludedHolidayDays: number | null;
    notes: string | null;
    label: string;
    updatedAt: string | null;
  } | null;
  availability!: {
    isUnavailable: boolean;
    availabilityMode: string | null;
    startDate: string | null;
    endDate: string | null;
    comment: string | null;
  };
  activeSubstitutions!: Array<{
    id: string;
    role: 'primary' | 'replacement';
    counterpartEmployeeId: string;
    counterpartEmployeeName: string;
    startDate: string;
    endDate: string | null;
    status: string;
    reason: string;
    comment: string | null;
  }>;
}
