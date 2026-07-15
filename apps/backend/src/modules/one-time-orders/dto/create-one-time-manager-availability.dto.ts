import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

import { ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES } from '../types/one-time-manager-availability.type';

export class CreateOneTimeManagerAvailabilityRequestDto {
  @IsIn(ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES)
  entryType!: (typeof ONE_TIME_MANAGER_AVAILABILITY_ENTRY_TYPES)[number];

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class CreateOneTimeManagerAvailabilityDirectDto extends CreateOneTimeManagerAvailabilityRequestDto {
  @IsUUID('4')
  userId!: string;
}
