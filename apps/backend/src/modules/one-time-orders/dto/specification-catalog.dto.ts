import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CreateSpecificationCatalogItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSpecificationCatalogItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class SpecificationTemplateItemSelectionDto {
  @IsString()
  @MinLength(1)
  catalogItemId!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class CreateSpecificationTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsArray()
  @ArrayUnique(
    (item: SpecificationTemplateItemSelectionDto) => item.catalogItemId,
  )
  @ValidateNested({ each: true })
  @Type(() => SpecificationTemplateItemSelectionDto)
  items!: SpecificationTemplateItemSelectionDto[];
}

export class UpdateSpecificationTemplateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique(
    (item: SpecificationTemplateItemSelectionDto) => item.catalogItemId,
  )
  @ValidateNested({ each: true })
  @Type(() => SpecificationTemplateItemSelectionDto)
  items?: SpecificationTemplateItemSelectionDto[];
}

export class SpecificationTemplateResponseDto {
  id!: string;
  name!: string;
  isArchived!: boolean;
  version!: number;
  items!: Array<{
    catalogItemId: string;
    title: string;
    description: string | null;
    sortOrder: number;
  }>;
}

export class SpecificationCatalogItemResponseDto {
  id!: string;
  title!: string;
  description!: string | null;
  sortOrder!: number;
  isArchived!: boolean;
  updatedAt!: string;
}
