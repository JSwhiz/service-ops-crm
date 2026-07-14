import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { normalizeTaskUserIds } from '../utils/task-user-ids.util';

export class AddTaskAssigneesDto {
  @IsArray()
  @Transform(({ value }) =>
    Array.isArray(value) ? normalizeTaskUserIds(value) : value,
  )
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class CompleteTaskAssignmentDto {
  @IsOptional()
  @IsString()
  completionId?: string;

  @IsOptional()
  @IsString()
  completionText?: string;
}

export class TaskReasonDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}
