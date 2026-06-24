import {
  canAccessChats,
  canCreateDirectChat,
  canCreateGroupChat,
  canManageChats,
} from './chat-access.util';

export function buildChatGlobalCapabilities(roleCodes: string[]): {
  canAccessChats: boolean;
  canManageChats: boolean;
  canCreateDirectChat: boolean;
  canCreateGroupChat: boolean;
} {
  return {
    canAccessChats: canAccessChats(),
    canManageChats: canManageChats(roleCodes),
    canCreateDirectChat: canCreateDirectChat(),
    canCreateGroupChat: canCreateGroupChat(roleCodes),
  };
}
