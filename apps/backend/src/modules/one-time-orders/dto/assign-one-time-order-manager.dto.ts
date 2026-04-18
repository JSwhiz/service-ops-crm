import { IsUUID } from 'class-validator';

export class AssignOneTimeOrderManagerDto {
  @IsUUID('4')
  userId!: string;
}
