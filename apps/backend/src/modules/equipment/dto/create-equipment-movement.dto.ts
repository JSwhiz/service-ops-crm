import { IsIn, IsOptional, IsString } from 'class-validator';

import { EQUIPMENT_MOVEMENT_TYPES } from '../types/equipment.type';

export class CreateEquipmentMovementDto {
  @IsIn(EQUIPMENT_MOVEMENT_TYPES)
  movementType!: (typeof EQUIPMENT_MOVEMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  toObjectId?: string;

  @IsOptional()
  @IsString()
  toOneTimeOrderId?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
