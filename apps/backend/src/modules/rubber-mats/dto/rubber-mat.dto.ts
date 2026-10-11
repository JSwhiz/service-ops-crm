import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const RUBBER_MAT_CONDITIONS = ['good', 'worn', 'damaged', 'retired'] as const;

export class RegisterRubberMatDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(5000)
  lengthCm!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(5000)
  widthCm!: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(500)
  thicknessMm?: number;

  @IsOptional() @IsString() @MaxLength(80)
  inventoryCode?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @IsString() @MinLength(2) @MaxLength(500)
  note!: string;
}

export class AssignRubberMatDto {
  @IsString() @MinLength(1) @MaxLength(160)
  zone!: string;

  @IsString() @MinLength(2) @MaxLength(500)
  note!: string;
}

export class ReturnRubberMatDto {
  @IsString() @MinLength(2) @MaxLength(500)
  note!: string;
}

export class UpdateRubberMatDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160)
  zone?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(5000)
  lengthCm?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(5000)
  widthCm?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.1) @Max(500)
  thicknessMm?: number | null;

  @IsOptional() @IsIn(RUBBER_MAT_CONDITIONS)
  condition?: (typeof RUBBER_MAT_CONDITIONS)[number];

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string | null;

  @IsString() @MinLength(2) @MaxLength(500)
  note!: string;
}

export class MoveRubberMatDto {
  @IsString() @MinLength(1)
  targetObjectId!: string;

  @IsString() @MinLength(1) @MaxLength(160)
  zone!: string;

  @IsString() @MinLength(2) @MaxLength(500)
  note!: string;
}

export class ServiceRubberMatDto {
  @IsString() @MinLength(2) @MaxLength(500)
  note!: string;
}
