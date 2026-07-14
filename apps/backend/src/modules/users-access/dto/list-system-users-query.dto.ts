import { IsIn, IsOptional, IsString } from 'class-validator';

export const SYSTEM_USER_PURPOSES = [
  'object_manager',
  'object_responsible',
  'task_assignee',
  'task_visibility',
  'one_time_order_manager',
  'one_time_order_task_assignee',
  'chat_participant',
] as const;

export class ListSystemUsersQueryDto {
  @IsIn(SYSTEM_USER_PURPOSES)
  purpose!: (typeof SYSTEM_USER_PURPOSES)[number];

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsString()
  oneTimeOrderId?: string;
}
