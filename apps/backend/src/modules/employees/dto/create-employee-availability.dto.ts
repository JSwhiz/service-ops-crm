import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

import { EMPLOYEE_AVAILABILITY_STATUSES } from '../constants/employee-hr.constants';

export class CreateEmployeeAvailabilityDto {
  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsIn(EMPLOYEE_AVAILABILITY_STATUSES)
  availabilityStatus!: (typeof EMPLOYEE_AVAILABILITY_STATUSES)[number];

  @IsOptional()
  @IsString()
  comment?: string;
}
