export type ChatRoomCode = 'objects' | 'one_time_orders' | 'leadership';

export type ChatRoomType = 'system_default' | 'direct' | 'group';

export type ChatVisibilityType =
  | 'objects_scope'
  | 'one_time_orders_scope'
  | 'leadership_only'
  | 'explicit_members';

export type ChatMessageType = 'user' | 'system';

export type ChatParticipantRole = 'admin' | 'member';

export interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}
