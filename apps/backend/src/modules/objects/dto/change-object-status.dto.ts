import { IsIn } from 'class-validator';

import { OBJECT_STATUSES } from '../types/object-status.type';

export class ChangeObjectStatusDto {
  @IsIn(OBJECT_STATUSES)
  status!: 'active' | 'archived' | 'frozen';
}
