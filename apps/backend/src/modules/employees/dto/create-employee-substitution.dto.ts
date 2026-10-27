import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

import { EMPLOYEE_SUBSTITUTION_STATUSES } from '../constants/employee-hr.constants';

export class CreateEmployeeSubstitutionDto {
  @IsOptional()
  @IsUUID('4')
  rateOptionId?: string;
  @IsString()
  substituteEmployeeId!: string;

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsString()
  @MinLength(2)
  reason!: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_SUBSTITUTION_STATUSES)
  status?: (typeof EMPLOYEE_SUBSTITUTION_STATUSES)[number];
}
