import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { TASK_STATUSES } from '../types/task-status.type';

export class ListTasksQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsString()
  oneTimeOrderId?: string;

  @IsOptional()
  @IsString()
  assignedToMe?: string;

  @IsOptional()
  @IsString()
  creatorUserId?: string;

  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  createdByMe?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  myObjects?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'dueAt', 'title'])
  sortBy?: 'createdAt' | 'updatedAt' | 'dueAt' | 'title';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
