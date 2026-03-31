export interface TimesheetEntry {
  dayOfMonth: number;
  dayValue: number;
  comment: string | null;
  isChangedManually: boolean;
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
  rows: TimesheetRow[];
}
