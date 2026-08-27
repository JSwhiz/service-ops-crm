import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  EMPLOYEE_EMPLOYMENT_STATUSES,
  EMPLOYEE_TYPES,
  EMPLOYEE_WORK_SCHEDULE_CODES,
} from '../constants/employee-hr.constants';

export const EMPLOYEE_ARCHIVE_STATES = ['active', 'archived', 'all'] as const;
export const EMPLOYEE_SORT_FIELDS = [
  'fullName',
  'position',
  'employmentStatus',
  'employeeType',
  'birthDate',
  'createdAt',
  'updatedAt',
] as const;

function optionalTrimmedString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() || undefined : value;
}

export class ListEmployeesQueryDto {
  @IsOptional()
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsString()
  @MaxLength(150)
  position?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_EMPLOYMENT_STATUSES)
  employmentStatus?: (typeof EMPLOYEE_EMPLOYMENT_STATUSES)[number];

  @IsOptional()
  @IsIn(EMPLOYEE_TYPES)
  employeeType?: (typeof EMPLOYEE_TYPES)[number];

  @IsOptional()
  @IsIn(EMPLOYEE_WORK_SCHEDULE_CODES)
  workScheduleCode?: (typeof EMPLOYEE_WORK_SCHEDULE_CODES)[number];

  @IsOptional()
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsString()
  @MaxLength(200)
  workTimeSearch?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_ARCHIVE_STATES)
  archiveState: (typeof EMPLOYEE_ARCHIVE_STATES)[number] = 'active';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  birthMonth?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  hasActiveObjectAssignment?: boolean;

  @IsOptional()
  @IsIn(EMPLOYEE_SORT_FIELDS)
  sortBy: (typeof EMPLOYEE_SORT_FIELDS)[number] = 'fullName';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
