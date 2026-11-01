import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

import { ONE_TIME_ORDER_STATUSES } from "../types/one-time-order-status.type";
import { ONE_TIME_ORDER_PAYMENT_METHODS } from "../types/one-time-order-payment-method.type";
import { CreateOneTimeOrderSpecificationItemDto } from "./create-one-time-order-specification-item.dto";

export class CreateOneTimeOrderDto {
  @IsOptional()
  @IsUUID()
  creationRequestId?: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(3)
  executionAddress!: string;

  @IsOptional()
  @IsString()
  linkedObjectId?: string;

  @IsOptional()
  @IsIn(ONE_TIME_ORDER_STATUSES)
  status?: (typeof ONE_TIME_ORDER_STATUSES)[number];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  executionDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  executionStartDate?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  executionEndDate?: string | null;

  @IsString()
  @MinLength(2)
  contactName!: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  agreedSum?: number;

  @IsIn(ONE_TIME_ORDER_PAYMENT_METHODS)
  plannedPaymentMethod!: (typeof ONE_TIME_ORDER_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  financialNotes?: string;

  @IsOptional()
  @IsString()
  expenseNotes?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  managerUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  specificationCatalogItemIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  specificationTemplateIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOneTimeOrderSpecificationItemDto)
  specificationItems?: CreateOneTimeOrderSpecificationItemDto[];

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  conflictFingerprint?: string;
}
