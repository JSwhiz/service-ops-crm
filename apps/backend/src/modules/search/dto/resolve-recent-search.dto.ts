import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, IsUUID, ValidateNested } from 'class-validator';

const RECENT_ENTITY_TYPES = [
  'object',
  'one_time_order',
  'task',
  'employee',
  'candidate',
] as const;

export class RecentSearchRefDto {
  @IsIn(RECENT_ENTITY_TYPES)
  type!: (typeof RECENT_ENTITY_TYPES)[number];

  @IsString()
  @IsUUID('4')
  id!: string;
}

export class ResolveRecentSearchDto {
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => RecentSearchRefDto)
  refs!: RecentSearchRefDto[];
}
