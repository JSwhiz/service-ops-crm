import { IsIn, IsOptional, IsString } from 'class-validator';

import { EMPLOYEE_EMPLOYMENT_STATUSES } from '../constants/employee-hr.constants';

export class ListEmployeesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_EMPLOYMENT_STATUSES)
  employmentStatus?: (typeof EMPLOYEE_EMPLOYMENT_STATUSES)[number];
}
