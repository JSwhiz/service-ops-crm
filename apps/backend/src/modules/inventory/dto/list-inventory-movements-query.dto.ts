import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { INVENTORY_MOVEMENT_TYPES } from '../types/inventory-movement.type';

export class ListInventoryMovementsQueryDto {
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @IsOptional()
  @IsIn(INVENTORY_MOVEMENT_TYPES)
  movementType?: (typeof INVENTORY_MOVEMENT_TYPES)[number];

  @IsOptional()
  @IsIn(['applied', 'pending_approval', 'rejected', 'cancelled'])
  status?: 'applied' | 'pending_approval' | 'rejected' | 'cancelled';

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsString()
  oneTimeOrderId?: string;

  @IsOptional()
  @IsString()
  approvalBridge?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
