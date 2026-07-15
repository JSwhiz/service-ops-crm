import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

import { ONE_TIME_ORDER_STATUSES } from '../types/one-time-order-status.type';

export class ListOneTimeOrderCalendarQueryDto {
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @IsOptional()
  @IsUUID('4')
  managerUserId?: string;

  @IsOptional()
  @IsIn(ONE_TIME_ORDER_STATUSES)
  status?: (typeof ONE_TIME_ORDER_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeCancelled?: boolean;
}
