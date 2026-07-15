import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES } from '../types/one-time-manager-availability.type';

export class UpdateOneTimeManagerAvailabilityDto {
  @IsOptional()
  @IsIn(ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES)
  entryType?: (typeof ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES)[number];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
