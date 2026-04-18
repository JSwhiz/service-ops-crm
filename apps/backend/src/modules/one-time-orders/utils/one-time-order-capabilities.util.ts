import { canViewObjectByScope } from '../../objects/utils/object-access.util';

import {
  canCreateTaskOnOneTimeOrder,
  canEditOneTimeOrderByScope,
  canManageOneTimeOrderManagers,
} from './one-time-order-access.util';

export interface OneTimeOrderCapabilities {
  canEdit: boolean;
  canChangeStatus: boolean;
  canManageManagers: boolean;
  canComment: boolean;
  canAttachFiles: boolean;
  canCreateTask: boolean;
}

export function buildOneTimeOrderCapabilities(params: {
  currentUserId: string;
  roleCodes: string[];
  order: {
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive?: boolean;
    }>;
  };
}): OneTimeOrderCapabilities {
  const canEdit = canEditOneTimeOrderByScope(params);

  return {
    canEdit,
    canChangeStatus: canEdit,
    canManageManagers: canManageOneTimeOrderManagers(params.roleCodes),
    canComment: canEdit,
    canAttachFiles: canEdit,
    canCreateTask: canCreateTaskOnOneTimeOrder(params),
  };
}

export function canOpenLinkedObjectCard(params: {
  currentUserId: string;
  roleCodes: string[];
  linkedObject?: {
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      isActive?: boolean;
    }>;
  } | null;
}): boolean {
  if (!params.linkedObject) {
    return false;
  }

  return canViewObjectByScope({
    currentUserId: params.currentUserId,
    roleCodes: params.roleCodes,
    object: params.linkedObject,
  });
}
