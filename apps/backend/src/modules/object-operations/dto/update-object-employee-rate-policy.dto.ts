import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import {
  TIMESHEET_RATE_POLICY_TYPES,
  TIMESHEET_RATE_ROUNDING_MODES,
  TIMESHEET_RATE_SCHEDULE_CODES,
} from '../../timesheets/types/timesheet-rate-policy.type';

export class UpdateObjectEmployeeRatePolicyDto {
  @IsIn(TIMESHEET_RATE_POLICY_TYPES)
  ratePolicyType!: string;

  @IsInt()
  @Min(0)
  baseAmount!: number;

  @IsOptional()
  @IsIn(TIMESHEET_RATE_SCHEDULE_CODES)
  scheduleCode?: string;

  @IsOptional()
  @IsIn(TIMESHEET_RATE_ROUNDING_MODES)
  roundingMode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  roundingStep?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  standardShiftHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  workingDaysInMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  excludedHolidayDays?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
