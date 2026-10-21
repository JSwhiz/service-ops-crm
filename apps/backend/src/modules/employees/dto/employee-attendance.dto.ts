import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class EmployeeAttendanceQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

/**
 * Read-only month view of actual attendance facts (ObjectAttendanceFact).
 * A day is a worked day only when an attendance fact exists; planned schedule,
 * availability and timesheet money values are intentionally not part of it.
 */
export class EmployeeAttendanceResponseDto {
  year!: number;
  month!: number;
  days!: Array<{
    /** Business date-only value, YYYY-MM-DD. */
    date: string;
    objects: Array<{
      objectId: string;
      objectName: string;
      canOpenObjectCard: boolean;
      workedHours: number | null;
    }>;
  }>;
}
