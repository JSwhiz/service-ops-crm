import { ArrayUnique, IsArray, IsDateString, IsOptional, IsString } from 'class-validator';

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
}
