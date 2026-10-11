import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { RUBBER_MAT_CONDITIONS } from './rubber-mat.dto';

export class ListRubberMatsQueryDto {
  @IsOptional() @IsString() @MaxLength(160)
  q?: string;

  @IsOptional() @IsString()
  objectId?: string;

  @IsOptional() @IsIn(RUBBER_MAT_CONDITIONS)
  condition?: (typeof RUBBER_MAT_CONDITIONS)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;
}
