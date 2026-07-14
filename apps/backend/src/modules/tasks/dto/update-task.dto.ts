import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

import { TASK_PRIORITIES } from '../types/task-status.type';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsString()
  objectId?: string | null;

  @IsOptional()
  @IsString()
  oneTimeOrderId?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresConfirmation?: boolean;

  @IsOptional()
  @IsIn([
    'none',
    'comment_or_file',
    'comment_required',
    'file_required',
  ])
  completionRequirement?:
    | 'none'
    | 'comment_or_file'
    | 'comment_required'
    | 'file_required';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime?: string | null;

  @IsOptional()
  @IsIn(['scope', 'selected'])
  visibilityMode?: 'scope' | 'selected';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleUserIds?: string[];

  @IsOptional()
  @IsBoolean()
  resetCompletions?: boolean;
}
