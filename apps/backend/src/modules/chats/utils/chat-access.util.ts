import type { ChatRoomCode } from '../types/chat.types';

export const CHAT_LEADERSHIP_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
] as const;

export const CHAT_OPERATIONAL_ROLE_CODES = [
  ...CHAT_LEADERSHIP_ROLE_CODES,
  'deputy_director',
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

export const CHAT_ADMIN_ROLE_CODES = [
  ...CHAT_LEADERSHIP_ROLE_CODES,
  'deputy_director',
] as const;

export const CHAT_GLOBAL_CLOSE_LOGINS = [
  'gerasimov',
  'lebedev',
  'stepanova',
] as const;

function hasAnyRole(roleCodes: string[], allowed: readonly string[]): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

export function isChatLeadership(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, CHAT_LEADERSHIP_ROLE_CODES);
}

export function hasOperationalChatRole(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, CHAT_OPERATIONAL_ROLE_CODES);
}

export function canAccessChats(): boolean {
  return true;
}

export function canManageChats(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, CHAT_ADMIN_ROLE_CODES);
}

export function canCreateDirectChat(): boolean {
  return canAccessChats();
}

export function canCreateGroupChat(roleCodes: string[]): boolean {
  return canManageChats(roleCodes);
}

export function canCloseChatGlobally(login: string): boolean {
  return CHAT_GLOBAL_CLOSE_LOGINS.includes(login as never);
}

export function canAccessDefaultChatByRole(
  roleCodes: string[],
  code: ChatRoomCode,
): boolean {
  if (code === 'leadership') {
    return isChatLeadership(roleCodes);
  }

  return hasOperationalChatRole(roleCodes);
}
