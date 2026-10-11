import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNumber,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ObjectAttendanceEmployeeFactDto {
  @IsUUID('4')
  employeeId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  workedHours?: number;

  @IsOptional()
  @IsIn(['complex_shift', 'side_job'])
  ratePolicyType?: 'complex_shift' | 'side_job';

  @IsOptional()
  @IsInt() @Min(0) @Max(2147483647)
  rateAmount?: number;

  @IsOptional()
  @IsString() @MaxLength(1000)
  rateReason?: string;

  @IsOptional()
  @IsIn([true])
  clearRateOverride?: true;
}

export class UpsertObjectAttendanceDto {
  @IsDateString()
  operationDate!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  employeeIds!: string[];

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ObjectAttendanceEmployeeFactDto)
  employeeFacts?: ObjectAttendanceEmployeeFactDto[];
}
