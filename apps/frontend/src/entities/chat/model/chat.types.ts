import type { AttachedFile } from '@/entities/file/model/file.types';

export type ChatRoomCode = 'objects' | 'one_time_orders' | 'leadership';

export interface ChatRoom {
  id: string;
  code: ChatRoomCode | null;
  title: string;
  displayTitle: string;
  roomType: string;
  visibilityType: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastReadAt: string | null;
  unreadCount: number;
  participantCount: number;
  capabilities: {
    canWrite: boolean;
    canManage: boolean;
    canHide: boolean;
    canLeave: boolean;
    canCloseGlobally: boolean;
  };
}

export interface ChatUserSummary {
  id: string;
  login: string;
  fullName: string;
}

export interface ChatRoomParticipant {
  id: string;
  roleInRoom: 'admin' | 'member' | string;
  joinedAt: string;
  lastReadAt: string | null;
  leftAt: string | null;
  user: ChatUserSummary;
}

export interface ChatMessage {
  id: string;
  chatRoomId: string;
  messageType: 'user' | 'system';
  text: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  isDeleted: boolean;
  replyTo: {
    id: string;
    text: string | null;
    author: ChatUserSummary | null;
    createdAt: string;
    isDeleted: boolean;
    isAccessRestricted: boolean;
  } | null;
  forwardedFrom: {
    id: string;
    text: string | null;
    author: ChatUserSummary | null;
    createdAt: string;
    isDeleted: boolean;
    isAccessRestricted: boolean;
  } | null;
  reactionCounts: Record<string, number>;
  myReactions: string[];
  author: ChatUserSummary | null;
  attachments: AttachedFile[];
  capabilities: {
    canEdit: boolean;
    canDelete: boolean;
  };
}

export interface ChatSearchResponse {
  rooms: Array<{
    id: string;
    title: string;
    displayTitle: string;
    roomType: string;
    lastMessagePreview: string | null;
  }>;
  messages: Array<{
    id: string;
    roomId: string;
    text: string;
    createdAt: string;
    author: ChatUserSummary | null;
    room: {
      id: string;
      title: string;
      displayTitle: string;
    };
  }>;
}

export interface ChatMessageWindow {
  messages: ChatMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
  anchorMessageId: string | null;
  unreadMessageId: string | null;
  isLatestWindow: boolean;
}
