import { FileResponseDto } from '../../files/dto/file-response.dto';

export class ChatUserSummaryDto {
  id!: string;
  login!: string;
  fullName!: string;
}

export class ChatRoomResponseDto {
  id!: string;
  code!: string | null;
  title!: string;
  roomType!: string;
  visibilityType!: string;
  lastMessageAt!: string | null;
  lastMessagePreview!: string | null;
  lastReadAt!: string | null;
  unreadCount!: number;
  participantCount!: number;
  capabilities!: {
    canWrite: boolean;
    canManage: boolean;
  };
}

export class ChatRoomParticipantResponseDto {
  id!: string;
  roleInRoom!: string;
  joinedAt!: string;
  lastReadAt!: string | null;
  user!: ChatUserSummaryDto;
}

export class ChatMessageResponseDto {
  id!: string;
  chatRoomId!: string;
  messageType!: string;
  text!: string | null;
  metadata!: Record<string, unknown> | null;
  createdAt!: string;
  updatedAt!: string;
  editedAt!: string | null;
  author!: ChatUserSummaryDto | null;
  attachments!: FileResponseDto[];
  capabilities!: {
    canEdit: boolean;
  };
}
