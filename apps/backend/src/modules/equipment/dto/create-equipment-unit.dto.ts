import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEquipmentUnitDto {
  @IsString()
  catalogItemId!: string;

  @IsString()
  @MinLength(2)
  inventoryNumber!: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
