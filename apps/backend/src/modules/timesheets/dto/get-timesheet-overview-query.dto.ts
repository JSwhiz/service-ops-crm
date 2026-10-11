import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  Matches,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const optionalTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GetTimesheetOverviewQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2024)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsOptional()
  @Matches(CANONICAL_UUID_PATTERN)
  objectId?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_PATTERN)
  employeeId?: string;
}

export class ListTimesheetOverviewObjectsQueryDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_PATTERN)
  selectedId?: string;
}

export class ListTimesheetOverviewEmployeesQueryDto extends GetTimesheetOverviewQueryDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Matches(CANONICAL_UUID_PATTERN)
  selectedId?: string;
}
