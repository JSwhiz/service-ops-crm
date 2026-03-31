export class TimesheetResponseDto {
  objectId!: string;
  objectName!: string;
  year!: number;
  month!: number;
  status!: string;
  daysInMonth!: number;
  monthTotal!: number;
  rows!: Array<{
    employeeId: string;
    employeeName: string;
    rowTotal: number;
    entries: Array<{
      dayOfMonth: number;
      dayValue: number;
      comment: string | null;
      isChangedManually: boolean;
    }>;
  }>;
}
