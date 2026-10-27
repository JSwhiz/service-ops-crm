import { IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';

export class CreateRubberMatSizeDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99999999.99)
  lengthCm!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99999999.99)
  widthCm!: number;

  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  replacementCost?: string | null;
}

export class UpdateRubberMatCostDto {
  @IsInt() @Min(1) @Max(2147483646)
  version!: number;

  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  replacementCost?: string | null;
}

export class SetRubberMatQuantityDto {
  @IsInt() @Min(0) @Max(2147483646)
  version!: number;

  @IsInt() @Min(0) @Max(2147483647)
  quantity!: number;
}
