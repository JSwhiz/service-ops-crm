import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const OBJECT_SORT_FIELDS = [
  'name',
  'internalName',
  'status',
  'updatedAt',
  'createdAt',
] as const;

function toInteger(value: unknown): unknown {
  if (value === undefined || value === '') {
    return undefined;
  }

  return Number(value);
}

export class ListObjectsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  // Kept for existing object selectors while the registry uses `q`.
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'frozen', 'archived'])
  status?: string;

  @Transform(({ value }) => toInteger(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Transform(({ value }) => {
    const parsed = toInteger(value);
    return typeof parsed === 'number'
      ? Math.min(Math.max(parsed, 1), 100)
      : parsed;
  })
  @IsOptional()
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsIn(OBJECT_SORT_FIELDS)
  sortBy?: (typeof OBJECT_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
