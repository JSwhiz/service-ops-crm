import { IsIn, IsOptional, IsString } from 'class-validator';

import { EQUIPMENT_STATUSES } from '../types/equipment.type';

export class ListEquipmentUnitsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(EQUIPMENT_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsString()
  oneTimeOrderId?: string;
}
