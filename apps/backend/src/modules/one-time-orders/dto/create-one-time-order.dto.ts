import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

import { ONE_TIME_ORDER_STATUSES } from '../types/one-time-order-status.type';

export class CreateOneTimeOrderDto {
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
  @IsBoolean()
  confirmScheduleConflicts?: boolean;
}
