import { IsIn } from 'class-validator';

export class ChangeObjectStatusDto {
  @IsIn(['active', 'archived', 'frozen'])
  status!: 'active' | 'archived' | 'frozen';
}
