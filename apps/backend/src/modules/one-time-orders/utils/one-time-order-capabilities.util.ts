import {
  canViewObjectByScope,
} from '../../objects/utils/object-access.util';
import { canCorrectAccountabilityReceipt } from '../../accountability/utils/accountability-access.util';

import {
  canAccessOneTimeOrders,
  canCreateOneTimeOrder,
  canManageOneTimeOrderManagers,
  hasActiveOneTimeOrderAssignment,
  hasOneTimeOrderManagementAccess,
  hasOneTimeOrderPermission,
  ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
  ONE_TIME_ORDER_REVIEW_EDIT_PERMISSION,
  ONE_TIME_ORDER_REVIEW_VIEW_ALL_PERMISSION,
  hasWideOneTimeOrderAccess,
} from './one-time-order-access.util';

export interface OneTimeOrderGlobalCapabilities {
  canAccessOneTimeOrders: boolean;
  canCreateOneTimeOrder: boolean;
  canViewAllOneTimeOrderReviews: boolean;
  canViewOneTimeOrderCalendar: boolean;
  canManageOwnOneTimeOrderAvailability: boolean;
  canManageAnyOneTimeOrderAvailability: boolean;
  canApproveOneTimeOrderAvailability: boolean;
}

export function buildOneTimeOrderGlobalCapabilities(params: {
  roleCodes: string[];
  permissionCodes?: string[];
  isConfiguredCalendarManager?: boolean;
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
    params.isConfiguredCalendarManager === true;
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
    canViewAllOneTimeOrderReviews:
      hasWideOneTimeOrderAccess(params.roleCodes) ||
      hasOneTimeOrderPermission(
        params.permissionCodes,
        ONE_TIME_ORDER_REVIEW_VIEW_ALL_PERMISSION,
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
  canComplete: boolean;
  canReopen: boolean;
  canCorrectPayments: boolean;
  canManageManagers: boolean;
  canManageSpecification: boolean;
  canUploadPhotos: boolean;
  canDeletePhotos: boolean;
  canRestorePhotos: boolean;
  canComment: boolean;
  canAttachFiles: boolean;
  canCreateTask: boolean;
  canEditReview: boolean;
  canCopy: boolean;
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
    status: string;
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
    canChangeStatus:
      canEditOperationalFields && params.order.status !== 'completed',
    canComplete:
      canEditOperationalFields &&
      params.order.status !== 'completed' &&
      params.order.status !== 'cancelled',
    canReopen:
      canEditOperationalFields && params.order.status === 'completed',
    canCorrectPayments: canCorrectAccountabilityReceipt({
      permissionCodes: params.permissionCodes,
    }),
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
    canCopy: canCreateOneTimeOrder(
      params.roleCodes,
      params.permissionCodes,
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
