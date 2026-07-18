import { IsIn, IsInt, Min } from 'class-validator';

import { EMPLOYEE_EMPLOYMENT_STATUSES } from '../constants/employee-hr.constants';

export class ChangeEmployeeStatusDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(EMPLOYEE_EMPLOYMENT_STATUSES)
  employmentStatus!: (typeof EMPLOYEE_EMPLOYMENT_STATUSES)[number];
}
