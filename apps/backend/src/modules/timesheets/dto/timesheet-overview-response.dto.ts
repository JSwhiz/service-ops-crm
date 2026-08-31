import type { TimesheetRatePolicySnapshot } from '../types/timesheet-rate-policy.type';

export class TimesheetOverviewResponseDto {
  year!: number;
  month!: number;
  daysInMonth!: number;
  rows!: Array<{
    objectId: string;
    objectName: string;
    employeeId: string;
    employeeName: string;
    entries: Array<{
      dayOfMonth: number;
      finalValue: number;
      autoValue: number;
      manualValue: number | null;
      difference: number;
      isChangedManually: boolean;
      hasFact: boolean;
      workedHours: number | null;
      ratePolicySnapshot: TimesheetRatePolicySnapshot | null;
      comment: string | null;
      calculationExplanation: string | null;
    }>;
    advanceTotal: number;
    salaryTotal: number;
    monthTotal: number;
  }>;
  totals!: {
    advanceTotal: number;
    salaryTotal: number;
    monthTotal: number;
  };
  capabilities!: {
    canManualCorrection: boolean;
    canExport: boolean;
  };
}

export class TimesheetOverviewReferenceDto {
  id!: string;
  name!: string;
}
