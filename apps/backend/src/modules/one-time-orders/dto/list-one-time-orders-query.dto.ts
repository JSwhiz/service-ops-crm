import { IsIn, IsOptional, IsString } from 'class-validator';

import { ONE_TIME_ORDER_STATUSES } from '../types/one-time-order-status.type';

export class ListOneTimeOrdersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(ONE_TIME_ORDER_STATUSES)
  status?: (typeof ONE_TIME_ORDER_STATUSES)[number];
}
