import { IsUUID } from 'class-validator';

export class ForwardChatMessageDto {
  @IsUUID()
  targetRoomId!: string;
}
