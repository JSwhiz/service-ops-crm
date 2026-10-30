import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class DateRangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
export class ScheduleExceptionDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsBoolean() working!: boolean;
}
export class TemplateDto {
  @IsIn(['weekly', 'cycle', 'custom']) kind!: 'weekly' | 'cycle' | 'custom';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) anchorDate?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekdays?: number[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(366) @IsBoolean({ each: true }) sequence?: boolean[];
  @IsOptional() @IsArray() @ArrayMaxSize(366) @ValidateNested({ each: true }) @Type(() => ScheduleExceptionDto) exceptions?: ScheduleExceptionDto[];
}
export class TimeRangeDto {
  @IsString() @MinLength(1) @MaxLength(80) key!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) start!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) end!: string;
  @IsIn([0, 1]) endDayOffset!: 0 | 1;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) contourId?: string | null;
}
export class RotationAssignmentDto {
  @IsString() @MinLength(1) @MaxLength(80) employeeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string | null;
}
export class RotationGroupDto {
  @IsString() @MinLength(1) @MaxLength(80) key!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsInt() @Min(-3660) @Max(3660) offsetDays!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => TimeRangeDto) timeRanges!: TimeRangeDto[];
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => RotationAssignmentDto) assignments!: RotationAssignmentDto[];
}
export class PositionFieldsDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) headcount?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(10000) requiredPerShift?: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsDefined() @ValidateNested() @Type(() => TemplateDto) template!: TemplateDto;
  @IsArray() @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => RotationGroupDto) groups!: RotationGroupDto[];
}
export class CreatePositionDto extends PositionFieldsDto {
  @IsString() @MinLength(1) @MaxLength(80) clientKey!: string;
}
export class SavePositionDto extends PositionFieldsDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class ArchivePositionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class PreviewDto extends DateRangeDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) positionIds?: string[];
  @IsOptional() @ValidateNested() @Type(() => CreatePositionDto) draft?: CreatePositionDto;
}
export class EmployeeOptionsDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
export class CreateContourDto {
  @Matches(/^[a-zA-Z0-9_-]{1,80}$/) code!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsInt() @Min(0) @Max(100000000) dailyRate!: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) summerDailyRate?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) winterDailyRate?: number | null;
}
export class UpdateContourDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @ValidateIf((_, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(100000000) dailyRate?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) summerDailyRate?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) winterDailyRate?: number | null;
  @ValidateIf((_, value) => value !== undefined) @IsBoolean() isActive?: boolean;
}
export class ConfirmShiftDto {
  @IsString() @MinLength(1) @MaxLength(80) requestKey!: string;
  @IsString() @MinLength(1) @MaxLength(80) positionId!: string;
  @IsString() @MinLength(1) @MaxLength(80) revisionId!: string;
  @IsString() @MinLength(1) @MaxLength(80) groupKey!: string;
  @IsString() @MinLength(1) @MaxLength(80) timeRangeKey!: string;
  @IsString() @MinLength(1) @MaxLength(80) employeeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) operationDate!: string;
}
export class CancelShiftDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
