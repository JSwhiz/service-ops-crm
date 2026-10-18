import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateObjectCompensationRateDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsIn(['standard', 'substitution'])
  category?: 'standard' | 'substitution';

  @IsOptional() @IsIn(['daily_rate', 'monthly_fixed'])
  ratePolicyType?: 'daily_rate' | 'monthly_fixed';

  @IsOptional() @IsInt() @Min(0) @Max(2147483647)
  baseAmount?: number;

  @IsOptional() @IsIn(['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'])
  scheduleCode?: string | null;

  @IsOptional() @IsDateString()
  scheduleCycleStartDate?: string | null;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], { each: true })
  scheduleWeekdays?: string[];

  @IsOptional() @IsNumber() @Min(1) @Max(24)
  standardShiftHours?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
