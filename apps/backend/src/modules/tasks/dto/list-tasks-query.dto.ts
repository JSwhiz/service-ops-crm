import { IsOptional, IsString, IsIn } from 'class-validator';

import { TASK_STATUSES } from '../types/task-status.type';

export class ListTasksQueryDto {
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
  assignedToMe?: string;
}
