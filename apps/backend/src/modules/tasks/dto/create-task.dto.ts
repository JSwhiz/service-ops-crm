import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { TASK_PRIORITIES } from '../types/task-status.type';

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
  @ArrayMinSize(1)
  @IsString({ each: true })
  assigneeUserIds!: string[];

  @IsOptional()
  @IsIn(['scope', 'selected'])
  visibilityMode?: 'scope' | 'selected';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleUserIds?: string[];

  @IsOptional()
  @IsBoolean()
  requiresConfirmation?: boolean;
}
