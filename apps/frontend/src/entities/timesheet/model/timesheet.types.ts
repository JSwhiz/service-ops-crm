export interface TimesheetEntry {
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
  ratePolicySnapshot: Record<string, unknown> | null;
  calculationExplanation: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  updatedByUserName: string | null;
}

export interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  rowTotal: number;
  ratePolicy: TimesheetRatePolicy;
  entries: TimesheetEntry[];
}

export interface TimesheetRatePolicy {
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
  updatedAt?: string | null;
}

export interface TimesheetMonth {
  objectId: string;
  objectName: string;
  objectDailyRate: number;
  year: number;
  month: number;
  status: string;
  daysInMonth: number;
  monthTotal: number;
  capabilities: {
    canManualCorrection: boolean;
  };
  rows: TimesheetRow[];
}

export interface TimesheetCorrectionItem {
  employeeId: string;
  employeeName: string;
  dayOfMonth: number;
  dayValue: number;
  comment: string | null;
  hasFact: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
  updatedByUserName: string | null;
}
