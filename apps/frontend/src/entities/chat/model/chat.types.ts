import type { AttachedFile } from '@/entities/file/model/file.types';

export type ChatRoomCode = 'objects' | 'one_time_orders' | 'leadership';

export interface ChatRoom {
  id: string;
  code: ChatRoomCode | null;
  title: string;
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
  author: ChatUserSummary | null;
  attachments: AttachedFile[];
  capabilities: {
    canEdit: boolean;
  };
}
