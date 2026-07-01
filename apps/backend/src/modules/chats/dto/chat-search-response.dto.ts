import { ChatUserSummaryDto } from './chat-response.dto';

export class ChatSearchRoomResultDto {
  id!: string;
  title!: string;
  displayTitle!: string;
  roomType!: string;
  lastMessagePreview!: string | null;
}

export class ChatSearchMessageResultDto {
  id!: string;
  roomId!: string;
  text!: string;
  createdAt!: string;
  author!: ChatUserSummaryDto | null;
  room!: {
    id: string;
    title: string;
    displayTitle: string;
  };
}

export class ChatSearchResponseDto {
  rooms!: ChatSearchRoomResultDto[];
  messages!: ChatSearchMessageResultDto[];
}
