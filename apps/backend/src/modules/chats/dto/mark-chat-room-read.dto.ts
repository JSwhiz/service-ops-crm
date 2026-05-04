import { IsString } from 'class-validator';

export class MarkChatRoomReadDto {
  @IsString()
  lastReadMessageId!: string;
}
