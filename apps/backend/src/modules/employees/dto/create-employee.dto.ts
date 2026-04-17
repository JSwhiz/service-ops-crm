import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { EMPLOYEE_EMPLOYMENT_STATUSES } from '../constants/employee-hr.constants';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  residenceAddress?: string;

  @IsOptional()
  @IsString()
  shiftPreferences?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  baseDailyRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_EMPLOYMENT_STATUSES)
  employmentStatus?: (typeof EMPLOYEE_EMPLOYMENT_STATUSES)[number];
}
