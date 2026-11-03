import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class CompensationTermsDto {
  @IsOptional() @IsIn(['default', 'summer', 'winter']) seasonMode?: 'default' | 'summer' | 'winter';
  @IsOptional() @IsBoolean() automaticSeasons?: boolean;
  @IsOptional() @Matches(/^\d{2}-\d{2}$/) summerStartsOn?: string;
  @IsOptional() @Matches(/^\d{2}-\d{2}$/) winterStartsOn?: string;
  @IsIn(['daily_rate', 'monthly_fixed']) ratePolicyType!: 'daily_rate' | 'monthly_fixed';
  @IsInt() @Min(0) @Max(2147483647) baseAmount!: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) summerAmount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) winterAmount?: number | null;
  @IsOptional() @IsIn(['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0']) scheduleCode?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], {each: true}) scheduleWeekdays?: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) scheduleCycleStartDate?: string | null;
  @IsOptional() @IsBoolean() paidHolidays?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class CreateCompensationVersionDto {
  @IsString() @MinLength(1) @MaxLength(100) requestKey!: string;
  @IsIn(['contour', 'rate', 'defaults']) scope!: 'contour' | 'rate' | 'defaults';
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) scopeId?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @ValidateNested() @Type(() => CompensationTermsDto) terms!: CompensationTermsDto;
}
export class CancelCompensationVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class TeamFundAllocationDto {
  @IsString() @MinLength(1) positionId!: string;
  @IsString() @MinLength(1) contourId!: string;
  @IsInt() @Min(0) @Max(2147483647) monthlyAmount!: number;
}
export class CreateTeamFundDto {
  @IsString() @MinLength(1) @MaxLength(100) requestKey!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsInt() @Min(0) @Max(2147483647) monthlyAmount!: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({each: true}) @Type(() => TeamFundAllocationDto) allocations!: TeamFundAllocationDto[];
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class CreateCompensationAdjustmentDto {
  @IsString() @MinLength(1) @MaxLength(100) requestKey!: string;
  @IsIn(['extra_work', 'shift_override', 'replacement', 'holiday_exception']) kind!: 'extra_work' | 'shift_override' | 'replacement' | 'holiday_exception';
  @Matches(/^\d{4}-\d{2}-\d{2}$/) operationDate!: string;
  @IsOptional() @IsString() @MinLength(1) employeeId?: string;
  @IsOptional() @IsString() @MinLength(1) contourId?: string | null;
  @IsOptional() @IsString() @MinLength(1) attendanceId?: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) amount?: number;
  @IsOptional() @IsString() @MinLength(1) replacementEmployeeId?: string;
  @IsOptional() @IsString() @MinLength(1) substitutionId?: string;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class CompensationMonthDto {
  @Type(() => Number) @IsInt() @Min(2024) @Max(2100) year!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
}
export class CorrectExtraWorkDto {
  @IsString() @MinLength(1) @MaxLength(100) requestKey!: string;
  @IsDateString() expectedCreditUpdatedAt!: string;
  @IsInt() @Min(0) @Max(2147483647) amount!: number;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
