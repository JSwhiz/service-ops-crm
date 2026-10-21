import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { EmployeeCompensationDto } from './employee-response.dto';

export class ListEmployeeReferencesQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  selectedId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class EmployeePositionReferenceDto {
  value!: string;
  label!: string;
}

export class EmployeeObjectReferenceDto {
  id!: string;
  name!: string;
  /** Object default pay; null when the viewer may not see object rates. */
  compensation!: EmployeeCompensationDto | null;
}
