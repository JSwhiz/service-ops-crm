import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { TASK_PRIORITIES } from '../types/task-status.type';
import { normalizeTaskUserIds } from '../utils/task-user-ids.util';

export class CreateTaskDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(TASK_PRIORITIES)
  priority!: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsString()
  oneTimeOrderId?: string;

  @IsArray()
  @Transform(({ value }) =>
    Array.isArray(value) ? normalizeTaskUserIds(value) : value,
  )
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assigneeUserIds!: string[];

  @IsOptional()
  @IsIn(['scope', 'selected'])
  visibilityMode?: 'scope' | 'selected';

  @IsOptional()
  @IsIn(['all_users', 'selected_users', 'target_participants', 'private'])
  visibilityType?:
    | 'all_users'
    | 'selected_users'
    | 'target_participants'
    | 'private';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleUserIds?: string[];

  @IsOptional()
  @IsBoolean()
  requiresConfirmation?: boolean;

  @IsOptional()
  @IsIn(['none', 'comment_or_file', 'comment_required', 'file_required'])
  completionRequirement?:
    | 'none'
    | 'comment_or_file'
    | 'comment_required'
    | 'file_required';

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate!: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime?: string | null;
}
