import { IsDateString, IsIn, IsOptional } from 'class-validator';

import { EMPLOYEE_SUBSTITUTION_STATUSES } from '../constants/employee-hr.constants';

export class UpdateEmployeeSubstitutionDto {
  @IsOptional()
  @IsIn(EMPLOYEE_SUBSTITUTION_STATUSES)
  status?: (typeof EMPLOYEE_SUBSTITUTION_STATUSES)[number];

  /** New end boundary; used to finish an open-ended substitution. */
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateEmployeeAvailabilityDto {
  /** Date-only for full-day windows, ISO date-time for timed windows. */
  @IsDateString()
  endDate!: string;
}
