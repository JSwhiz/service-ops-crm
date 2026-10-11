import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UpsertTimesheetEntryDto {
  @Matches(CANONICAL_UUID_PATTERN)
  objectId!: string;

  @IsInt()
  @Min(2024)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Matches(CANONICAL_UUID_PATTERN)
  employeeId!: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth!: number;

  @IsInt()
  @Min(0)
  dayValue!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
