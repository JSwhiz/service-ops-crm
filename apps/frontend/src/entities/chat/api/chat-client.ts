import { fetcher } from '@/shared/api/fetcher';
import { appConfig } from '@/shared/config/app-config';

import type {
  ChatMessage,
  ChatRoom,
  ChatRoomCode,
  ChatRoomParticipant,
} from '../model/chat.types';

export type { ChatMessage, ChatRoom, ChatRoomCode } from '../model/chat.types';

export async function listChatRooms(params?: {
  view?: 'active' | 'archived';
}): Promise<ChatRoom[]> {
  const searchParams = new URLSearchParams();

  if (params?.view) {
    searchParams.set('view', params.view);
  }

  const query = searchParams.toString();

  return fetcher<ChatRoom[]>(`/chats/rooms${query ? `?${query}` : ''}`, {
    method: 'GET',
  });
}

export async function getChatRoomByCode(code: ChatRoomCode): Promise<ChatRoom> {
  return fetcher<ChatRoom>(`/chats/rooms/code/${code}`, {
    method: 'GET',
  });
}

export async function createChatRoom(payload: {
  title: string;
  participantUserIds?: string[];
}): Promise<ChatRoom> {
  return fetcher<ChatRoom>('/chats/rooms', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createDirectChat(payload: {
  targetUserId: string;
}): Promise<ChatRoom> {
  return fetcher<ChatRoom>('/chats/rooms/direct', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createGroupChat(payload: {
  title: string;
  participantUserIds: string[];
}): Promise<ChatRoom> {
  return fetcher<ChatRoom>('/chats/rooms/group', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function renameChatRoom(
  roomId: string,
  payload: { title: string },
): Promise<ChatRoom> {
  return fetcher<ChatRoom>(`/chats/rooms/${roomId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function addChatParticipants(
  roomId: string,
  payload: { userIds: string[] },
): Promise<ChatRoom> {
  return fetcher<ChatRoom>(`/chats/rooms/${roomId}/participants`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function hideChatRoom(roomId: string): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/chats/rooms/${roomId}/hide`, {
    method: 'POST',
  });
}

export async function unhideChatRoom(roomId: string): Promise<ChatRoom> {
  return fetcher<ChatRoom>(`/chats/rooms/${roomId}/unhide`, {
    method: 'POST',
  });
}

export async function leaveChatRoom(roomId: string): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/chats/rooms/${roomId}/leave`, {
    method: 'POST',
  });
}

export async function closeChatRoom(
  roomId: string,
  payload: { reason?: string },
): Promise<{ success: true }> {
  return fetcher<{ success: true }>(`/chats/rooms/${roomId}/close`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listChatRoomParticipants(
  roomId: string,
): Promise<ChatRoomParticipant[]> {
  return fetcher<ChatRoomParticipant[]>(`/chats/rooms/${roomId}/participants`, {
    method: 'GET',
  });
}

export async function listChatMessages(roomId: string): Promise<ChatMessage[]> {
  return fetcher<ChatMessage[]>(`/chats/rooms/${roomId}/messages`, {
    method: 'GET',
  });
}

export async function sendChatMessage(params: {
  roomId: string;
  text?: string;
  files?: File[];
}): Promise<ChatMessage> {
  const formData = new FormData();

  if (params.text?.trim()) {
    formData.set('text', params.text.trim());
  }

  for (const file of params.files ?? []) {
    formData.append('files', file);
  }

  return fetcher<ChatMessage>(`/chats/rooms/${params.roomId}/messages`, {
    method: 'POST',
    body: formData,
  });
}

export async function editChatMessage(
  messageId: string,
  payload: { text: string },
): Promise<ChatMessage> {
  return fetcher<ChatMessage>(`/chats/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteChatMessage(messageId: string): Promise<ChatMessage> {
  return fetcher<ChatMessage>(`/chats/messages/${messageId}/delete`, {
    method: 'POST',
  });
}

export async function markChatRoomRead(
  roomId: string,
  payload: { lastReadMessageId: string },
): Promise<ChatRoom> {
  return fetcher<ChatRoom>(`/chats/rooms/${roomId}/read`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function buildChatRealtimeUrl(): string {
  const url = new URL(appConfig.apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chats/realtime`;

  return url.toString();
}
