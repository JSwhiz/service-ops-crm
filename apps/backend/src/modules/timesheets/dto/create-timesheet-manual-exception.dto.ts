import { IsInt, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateTimesheetManualExceptionDto {
  @IsUUID('4')
  objectId!: string;

  @IsInt()
  @Min(2024)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsUUID('4')
  employeeId!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  @IsInt()
  dayValue!: number;

  @IsString()
  comment!: string;
}
