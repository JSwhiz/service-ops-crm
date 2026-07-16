import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { ONE_TIME_ORDER_STATUSES } from '../types/one-time-order-status.type';

export class ChangeOneTimeOrderStatusDto {
  @IsIn(ONE_TIME_ORDER_STATUSES)
  status!: (typeof ONE_TIME_ORDER_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  conflictFingerprint?: string;
}
