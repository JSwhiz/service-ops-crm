import { IsIn } from 'class-validator';

import { TASK_STATUSES } from '../types/task-status.type';

export class UpdateTaskStatusDto {
  @IsIn(TASK_STATUSES)
  status!: (typeof TASK_STATUSES)[number];
}
