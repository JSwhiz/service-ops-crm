import { IsUUID } from 'class-validator';

export class AssignObjectUserDto {
  @IsUUID('4')
  userId!: string;
}
