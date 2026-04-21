import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

import { INVENTORY_MOVEMENT_TYPES } from '../types/inventory-movement.type';

export class ListInventoryMovementsQueryDto {
  @IsOptional()
  @IsString()
  inventoryItemId?: string;

  @IsOptional()
  @IsIn(INVENTORY_MOVEMENT_TYPES)
  movementType?: (typeof INVENTORY_MOVEMENT_TYPES)[number];

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
}
