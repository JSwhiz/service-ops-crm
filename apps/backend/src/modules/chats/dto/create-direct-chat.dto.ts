import { IsString } from 'class-validator';

export class CreateDirectChatDto {
  @IsString()
  targetUserId!: string;
}
