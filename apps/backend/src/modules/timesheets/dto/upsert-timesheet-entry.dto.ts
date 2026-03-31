import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertTimesheetEntryDto {
  @IsString()
  objectId!: string;

  @IsInt()
  @Min(2024)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsString()
  employeeId!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  @IsInt()
  dayValue!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
