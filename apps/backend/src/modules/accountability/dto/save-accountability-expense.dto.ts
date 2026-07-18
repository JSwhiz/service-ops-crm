import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

import { ACCOUNTABILITY_EXPENSE_CATEGORIES } from '../utils/accountability-access.util';

export class SaveAccountabilityExpenseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  description!: string;

  @IsOptional()
  @IsUUID()
  oneTimeOrderId?: string;

  @IsOptional()
  @IsUUID()
  oneTimeOrderCompletionId?: string | null;

  @IsOptional()
  @IsIn(ACCOUNTABILITY_EXPENSE_CATEGORIES)
  expenseCategory?: (typeof ACCOUNTABILITY_EXPENSE_CATEGORIES)[number];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expenseDate?: string;
}
