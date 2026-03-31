export interface TimesheetEntry {
  dayOfMonth: number;
  attendanceStatus: string;
  note: string | null;
}

export interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  entries: TimesheetEntry[];
}

export interface TimesheetMonth {
  objectId: string;
  objectName: string;
  year: number;
  month: number;
  status: string;
  daysInMonth: number;
  rows: TimesheetRow[];
}
