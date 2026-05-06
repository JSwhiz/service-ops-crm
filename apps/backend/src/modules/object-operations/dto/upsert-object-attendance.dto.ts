import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
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
