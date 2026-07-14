import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class AddTaskAssigneesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
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
