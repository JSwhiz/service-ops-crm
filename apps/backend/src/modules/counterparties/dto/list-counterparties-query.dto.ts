import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { INVENTORY_MOVEMENT_TYPES } from '../../inventory/types/inventory-movement.type';

const optionalTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ListCounterpartiesQueryDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status: 'active' | 'archived' | 'all' = 'active';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ListCounterpartyReferencesQueryDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID('4')
  selectedId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class ListCounterpartyMovementsQueryDto {
  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @IsOptional()
  @IsUUID('4')
  objectId?: string;

  @IsOptional()
  @IsIn(INVENTORY_MOVEMENT_TYPES)
  movementType?: (typeof INVENTORY_MOVEMENT_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
