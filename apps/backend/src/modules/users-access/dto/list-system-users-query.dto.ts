import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const SYSTEM_USER_PURPOSES = [
  'object_manager',
  'object_responsible',
  'task_assignee',
] as const;

export class ListSystemUsersQueryDto {
  @IsIn(SYSTEM_USER_PURPOSES)
  purpose!: (typeof SYSTEM_USER_PURPOSES)[number];

  @IsOptional()
  @IsUUID('4')
  objectId?: string;
}
