import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const SYSTEM_USER_PURPOSES = [
  'object_manager',
  'object_responsible',
  'task_assignee',
  'task_visibility',
  'one_time_order_manager',
  'one_time_order_task_assignee',
  'one_time_order_payment_recipient',
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

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  selectedId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
