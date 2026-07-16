import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const ONE_TIME_ORDER_PAYMENT_METHODS = [
  'cash',
  'personal_card_transfer',
  'organization_transfer',
  'other',
] as const;

export const ONE_TIME_ORDER_PAYMENT_DESTINATIONS = [
  'manager_accountability',
  'organization',
] as const;

export const ONE_TIME_ORDER_PAYMENT_ZERO_REASONS = [
  'payment_later',
  'paid_directly_to_organization',
  'free_order',
  'customer_did_not_pay',
  'other',
] as const;

export class OneTimeOrderCompletionPaymentDto {
  @IsOptional()
  @IsString()
  recipientUserId?: string | null;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsIn(ONE_TIME_ORDER_PAYMENT_METHODS)
  paymentMethod!: (typeof ONE_TIME_ORDER_PAYMENT_METHODS)[number];

  @IsIn(ONE_TIME_ORDER_PAYMENT_DESTINATIONS)
  paymentDestination!: (typeof ONE_TIME_ORDER_PAYMENT_DESTINATIONS)[number];

  @IsOptional()
  @IsIn(ONE_TIME_ORDER_PAYMENT_ZERO_REASONS)
  zeroReason?: (typeof ONE_TIME_ORDER_PAYMENT_ZERO_REASONS)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  differenceReason?: string | null;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;
}

export class CompleteOneTimeOrderDto {
  @IsInt()
  @Min(1)
  workCycle!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completionComment?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  clientRequestId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OneTimeOrderCompletionPaymentDto)
  payments!: OneTimeOrderCompletionPaymentDto[];
}
