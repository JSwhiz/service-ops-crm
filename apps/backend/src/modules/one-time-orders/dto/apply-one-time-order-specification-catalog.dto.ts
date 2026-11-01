import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsISO8601,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SpecificationTemplateVersionExpectationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  templateId!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class SpecificationCatalogItemExpectationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  catalogItemId!: string;

  @IsISO8601()
  updatedAt!: string;
}

export class ApplyOneTimeOrderSpecificationCatalogDto {
  @IsUUID()
  requestId!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  templateIds!: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  catalogItemIds!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecificationTemplateVersionExpectationDto)
  expectedTemplateVersions!: SpecificationTemplateVersionExpectationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecificationCatalogItemExpectationDto)
  expectedCatalogItems!: SpecificationCatalogItemExpectationDto[];

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason?: string;
}
