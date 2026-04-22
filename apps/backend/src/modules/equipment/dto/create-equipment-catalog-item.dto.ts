import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEquipmentCatalogItemDto {
  @IsString()
  @MinLength(2)
  category!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
