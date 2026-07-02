import type { ChatRoomCode, ChatVisibilityType } from '../types/chat.types';

export const CHAT_MESSAGE_FILE_ENTITY_TYPE = 'chat_message' as const;

export const CHAT_REDIS_CHANNEL = 'service_ops:chat_events';

export const DEFAULT_CHAT_ROOMS: Array<{
  code: ChatRoomCode;
  title: string;
  visibilityType: ChatVisibilityType;
}> = [
  {
    code: 'objects',
    title: 'Объекты',
    visibilityType: 'objects_scope',
  },
  {
    code: 'one_time_orders',
    title: 'Разовые заказы',
    visibilityType: 'one_time_orders_scope',
  },
  {
    code: 'leadership',
    title: 'Руководство',
    visibilityType: 'leadership_only',
  },
];
