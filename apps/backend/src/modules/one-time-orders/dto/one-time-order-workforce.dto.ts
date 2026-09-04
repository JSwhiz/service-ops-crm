import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class AddOneTimeOrderEmployeeDto {
  @IsString()
  employeeId!: string;
}

export class SubmitOneTimeOrderAttendanceDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  employeeIds!: string[];
}

export class OneTimeOrderTimesheetQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workCycle?: number;
}
