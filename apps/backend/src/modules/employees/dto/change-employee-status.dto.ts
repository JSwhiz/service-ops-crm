import { IsIn } from 'class-validator';

import { EMPLOYEE_EMPLOYMENT_STATUSES } from '../constants/employee-hr.constants';

export class ChangeEmployeeStatusDto {
  @IsIn(EMPLOYEE_EMPLOYMENT_STATUSES)
  employmentStatus!: (typeof EMPLOYEE_EMPLOYMENT_STATUSES)[number];
}
