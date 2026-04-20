import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import {
  INVENTORY_ADJUSTMENT_DIRECTIONS,
  INVENTORY_MOVEMENT_TYPES,
} from '../types/inventory-movement.type';

export class CreateInventoryMovementDto {
  @IsString()
  inventoryItemId!: string;

  @IsIn(INVENTORY_MOVEMENT_TYPES)
  movementType!: (typeof INVENTORY_MOVEMENT_TYPES)[number];

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsIn(INVENTORY_ADJUSTMENT_DIRECTIONS)
  adjustmentDirection?: (typeof INVENTORY_ADJUSTMENT_DIRECTIONS)[number];

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsBoolean()
  evidenceRequired?: boolean;

  @IsOptional()
  @IsString()
  relatedObjectId?: string;

  @IsOptional()
  @IsString()
  relatedOneTimeOrderId?: string;
}
