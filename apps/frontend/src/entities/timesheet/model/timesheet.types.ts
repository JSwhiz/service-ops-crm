export interface TimesheetEntry {
  dayOfMonth: number;
  dayValue: number;
  comment: string | null;
  isChangedManually: boolean;
  hasFact: boolean;
}

export interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  rowTotal: number;
  entries: TimesheetEntry[];
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
