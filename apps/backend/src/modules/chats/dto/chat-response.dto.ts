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
  displayTitle!: string;
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
    canHide: boolean;
    canLeave: boolean;
    canCloseGlobally: boolean;
  };
}

export class ChatRoomParticipantResponseDto {
  id!: string;
  roleInRoom!: string;
  joinedAt!: string;
  lastReadAt!: string | null;
  leftAt!: string | null;
  user!: ChatUserSummaryDto;
}

export class ChatMessageReplyPreviewDto {
  id!: string;
  text!: string | null;
  author!: ChatUserSummaryDto | null;
  createdAt!: string;
  isDeleted!: boolean;
  isAccessRestricted!: boolean;
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
  deletedAt!: string | null;
  isDeleted!: boolean;
  replyTo!: ChatMessageReplyPreviewDto | null;
  forwardedFrom!: ChatMessageReplyPreviewDto | null;
  reactionCounts!: Record<string, number>;
  myReactions!: string[];
  author!: ChatUserSummaryDto | null;
  attachments!: FileResponseDto[];
  capabilities!: {
    canEdit: boolean;
    canDelete: boolean;
  };
}
