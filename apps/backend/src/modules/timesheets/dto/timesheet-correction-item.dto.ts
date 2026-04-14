export class TimesheetCorrectionItemDto {
  employeeId!: string;
  employeeName!: string;
  dayOfMonth!: number;
  dayValue!: number;
  comment!: string | null;
  hasFact!: boolean;
  updatedAt!: string;
  updatedByUserId!: string | null;
  updatedByUserName!: string | null;
}
