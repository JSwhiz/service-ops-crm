import {
  ArrayMinSize,
  IsArray,
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

  @IsString()
  objectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  assigneeUserIds!: string[];
}
