import { canManageChats } from './chat-access.util';

export function buildChatGlobalCapabilities(roleCodes: string[]): {
  canAccessChats: boolean;
  canManageChats: boolean;
} {
  return {
    canAccessChats: true,
    canManageChats: canManageChats(roleCodes),
  };
}
