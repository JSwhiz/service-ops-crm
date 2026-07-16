import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export class UpdateOneTimeOrderDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  executionAddress?: string;

  @IsOptional()
  @IsString()
  linkedObjectId?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  executionDate?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  executionStartDate?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  executionEndDate?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(2)
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  agreedSum?: number | null;

  @IsOptional()
  @IsString()
  financialNotes?: string | null;

  @IsOptional()
  @IsString()
  expenseNotes?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  conflictFingerprint?: string;
}
