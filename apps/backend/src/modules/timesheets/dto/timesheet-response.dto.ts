import type { TimesheetRatePolicySnapshot } from '../types/timesheet-rate-policy.type';

export class TimesheetResponseDto {
  objectId!: string;
  objectName!: string;
  objectDailyRate!: number;
  year!: number;
  month!: number;
  status!: string;
  daysInMonth!: number;
  monthTotal!: number;
  capabilities!: {
    canManualCorrection: boolean;
  };
  rows!: Array<{
    employeeId: string;
    employeeName: string;
    rowTotal: number;
    entries: Array<{
      dayOfMonth: number;
      dayValue: number;
      autoValue: number;
      finalValue: number;
      manualValue: number | null;
      difference: number;
      comment: string | null;
      isChangedManually: boolean;
      hasFact: boolean;
      workedHours: number | null;
      ratePolicySnapshot: TimesheetRatePolicySnapshot | null;
      calculationExplanation: string | null;
      updatedAt: string | null;
      updatedByUserId: string | null;
      updatedByUserName: string | null;
    }>;
    ratePolicy: {
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
    };
  }>;
}
