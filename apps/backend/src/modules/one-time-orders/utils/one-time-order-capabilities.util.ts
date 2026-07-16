import {
  canViewObjectByScope,
} from '../../objects/utils/object-access.util';

import {
  canAccessOneTimeOrders,
  canBeOneTimeOrderManager,
  canCreateOneTimeOrder,
  canManageOneTimeOrderManagers,
  hasActiveOneTimeOrderAssignment,
  hasOneTimeOrderManagementAccess,
  hasOneTimeOrderPermission,
  ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
  ONE_TIME_ORDER_REVIEW_EDIT_PERMISSION,
} from './one-time-order-access.util';

export interface OneTimeOrderGlobalCapabilities {
  canAccessOneTimeOrders: boolean;
  canCreateOneTimeOrder: boolean;
  canViewOneTimeOrderCalendar: boolean;
  canManageOwnOneTimeOrderAvailability: boolean;
  canManageAnyOneTimeOrderAvailability: boolean;
  canApproveOneTimeOrderAvailability: boolean;
}

export function buildOneTimeOrderGlobalCapabilities(params: {
  roleCodes: string[];
  permissionCodes?: string[];
  hasActiveManagerAssignment?: boolean;
}): OneTimeOrderGlobalCapabilities {
  const canManageAnyAvailability = hasOneTimeOrderPermission(
    params.permissionCodes,
    ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
  );
  const canApproveAvailability = hasOneTimeOrderPermission(
    params.permissionCodes,
    ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  );
  const canManageOwnAvailability =
    canBeOneTimeOrderManager(params.roleCodes) ||
    params.hasActiveManagerAssignment === true;
  const canAccess = canAccessOneTimeOrders(
    params.roleCodes,
    params.permissionCodes,
  );

  return {
    canAccessOneTimeOrders: canAccess,
    canCreateOneTimeOrder: canCreateOneTimeOrder(
      params.roleCodes,
      params.permissionCodes,
    ),
    canViewOneTimeOrderCalendar:
      canAccess ||
      canManageOwnAvailability ||
      canManageAnyAvailability ||
      canApproveAvailability,
    canManageOwnOneTimeOrderAvailability: canManageOwnAvailability,
    canManageAnyOneTimeOrderAvailability: canManageAnyAvailability,
    canApproveOneTimeOrderAvailability: canApproveAvailability,
  };
}

export interface OneTimeOrderCapabilities {
  canEdit: boolean;
  canEditOperationalFields: boolean;
  canEditFinancialFields: boolean;
  canChangeLinkedObject: boolean;
  canChangeStatus: boolean;
  canManageManagers: boolean;
  canManageSpecification: boolean;
  canUploadPhotos: boolean;
  canDeletePhotos: boolean;
  canRestorePhotos: boolean;
  canComment: boolean;
  canAttachFiles: boolean;
  canCreateTask: boolean;
  canEditReview: boolean;
  canViewCalendar: boolean;
  canManageOwnAvailability: boolean;
  canManageAnyAvailability: boolean;
  canApproveAvailability: boolean;
}

export function buildOneTimeOrderCapabilities(params: {
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
  order: {
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive?: boolean;
    }>;
  };
}): OneTimeOrderCapabilities {
  const hasFullAccess = hasOneTimeOrderManagementAccess(
    params.roleCodes,
    params.permissionCodes,
  );
  const isCreator = params.order.createdByUserId === params.currentUserId;
  const isActiveManager = hasActiveOneTimeOrderAssignment(
    params.order,
    params.currentUserId,
  );
  const canEditOperationalFields =
    hasFullAccess || isCreator || isActiveManager;
  const canEditFinancialFields = hasFullAccess || isCreator;
  const canManageManagers =
    isCreator ||
    canManageOneTimeOrderManagers(
      params.roleCodes,
      params.permissionCodes,
    );
  const canManageAnyAvailability = hasOneTimeOrderPermission(
    params.permissionCodes,
    ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
  );
  const canApproveAvailability = hasOneTimeOrderPermission(
    params.permissionCodes,
    ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  );

  return {
    canEdit: canEditOperationalFields || canEditFinancialFields,
    canEditOperationalFields,
    canEditFinancialFields,
    canChangeLinkedObject: hasFullAccess || isCreator,
    canChangeStatus: canEditOperationalFields,
    canManageManagers,
    canManageSpecification: canEditOperationalFields,
    canUploadPhotos: canEditOperationalFields,
    canDeletePhotos: canEditOperationalFields,
    canRestorePhotos: canEditOperationalFields,
    canComment: canEditOperationalFields,
    canAttachFiles: canEditOperationalFields,
    canCreateTask: canEditOperationalFields,
    canEditReview: hasOneTimeOrderPermission(
      params.permissionCodes,
      ONE_TIME_ORDER_REVIEW_EDIT_PERMISSION,
    ),
    canViewCalendar:
      canAccessOneTimeOrders(params.roleCodes, params.permissionCodes) ||
      canManageAnyAvailability ||
      canApproveAvailability,
    canManageOwnAvailability: isActiveManager,
    canManageAnyAvailability,
    canApproveAvailability,
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
