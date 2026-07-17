import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  ONE_TIME_ORDER_PAYMENT_DESTINATIONS,
  ONE_TIME_ORDER_PAYMENT_METHODS,
  ONE_TIME_ORDER_PAYMENT_ZERO_REASONS,
} from './complete-one-time-order.dto';

export class CorrectOneTimeOrderPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  correctedAmount!: number;

  @IsIn(ONE_TIME_ORDER_PAYMENT_METHODS)
  paymentMethod!: (typeof ONE_TIME_ORDER_PAYMENT_METHODS)[number];

  @IsIn(ONE_TIME_ORDER_PAYMENT_DESTINATIONS)
  paymentDestination!: (typeof ONE_TIME_ORDER_PAYMENT_DESTINATIONS)[number];

  @IsOptional()
  @IsUUID()
  recipientUserId?: string | null;

  @IsOptional()
  @IsIn(ONE_TIME_ORDER_PAYMENT_ZERO_REASONS)
  zeroReason?: (typeof ONE_TIME_ORDER_PAYMENT_ZERO_REASONS)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
