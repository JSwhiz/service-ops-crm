import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class AddOneTimeOrderEmployeeDto {
  @IsString()
  employeeId!: string;
}

export class UpdateOneTimeOrderEmployeePaymentDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number | null;
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
