import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { ATTENDANCE_STATUSES } from '../types/timesheet-status.type';

export class UpsertTimesheetEntryDto {
  @IsString()
  objectId!: string;

  @IsInt()
  @Min(2024)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsString()
  employeeId!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  @IsIn(ATTENDANCE_STATUSES)
  attendanceStatus!: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  note?: string;
}
