import { IsIn, IsOptional, IsString } from 'class-validator';

import { OBJECT_STATUSES } from '../types/object-status.type';

export class ListObjectsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(OBJECT_STATUSES)
  status?: 'active' | 'archived' | 'frozen';
}
