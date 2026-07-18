import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListInventoryItemsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === ''
      ? undefined
      : value === 'true' || value === true,
  )
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @IsIn(['name', 'category', 'unit', 'currentUnitPrice', 'createdAt', 'updatedAt'])
  sortBy:
    | 'name'
    | 'category'
    | 'unit'
    | 'currentUnitPrice'
    | 'createdAt'
    | 'updatedAt' = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'asc';
}
