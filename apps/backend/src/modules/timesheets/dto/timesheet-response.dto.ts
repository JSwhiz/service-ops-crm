export class TimesheetResponseDto {
  objectId!: string;
  objectName!: string;
  year!: number;
  month!: number;
  status!: string;
  daysInMonth!: number;
  rows!: Array<{
    employeeId: string;
    employeeName: string;
    entries: Array<{
      dayOfMonth: number;
      attendanceStatus: string;
      note: string | null;
    }>;
  }>;
}
