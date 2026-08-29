import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CreateOneTimeOrderDto } from './create-one-time-order.dto';

export class CopyOneTimeOrderSpecificationItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresAttachment?: boolean;
}

export class CopyOneTimeOrderDto extends CreateOneTimeOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopyOneTimeOrderSpecificationItemDto)
  specificationItems!: CopyOneTimeOrderSpecificationItemDto[];
}
