import {
  canViewObjectByScope,
} from '../../objects/utils/object-access.util';
import { canCorrectAccountabilityReceipt } from '../../accountability/utils/accountability-access.util';
import { AccessSubject, decideAccess, hasModuleDeny } from '../../users-access/utils/access-policy.util';

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
  canReadFinance: boolean;
  canReadComments: boolean;
  canReadReports: boolean;
  canReadPhotos: boolean;
  canReadSpecification: boolean;
  canReadEmployees: boolean;
  canReadInventory: boolean;
  canReadEquipment: boolean;
  canReadHistory: boolean;
  canReadFiles: boolean;
  canReadTasks: boolean;
  canReadAccountability: boolean;
  canReadPayouts: boolean;
  canUpdateReports: boolean;
  canReadEscorts: boolean;
  canManageOwnEscorts: boolean;
  canReadDeadline: boolean;
  canUpdateDeadline: boolean;
  canReadServiceLines: boolean;
  canUpdateServiceLines: boolean;
  canEdit: boolean;
  canEditOperationalFields: boolean;
  canEditFinancialFields: boolean;
  canChangeLinkedObject: boolean;
  canChangeStatus: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canCorrectPayments: boolean;
  canRegisterPayments: boolean;
  canManageManagers: boolean;
  canManageSpecification: boolean;
  canEditSpecification: boolean;
  canUploadPhotos: boolean;
  canDeletePhotos: boolean;
  canRestorePhotos: boolean;
  canComment: boolean;
  canAttachFiles: boolean;
  canCreateTask: boolean;
  canEditReview: boolean;
  canDeleteReview?: boolean;
  canCopy: boolean;
  canViewCalendar: boolean;
  canManageOwnAvailability: boolean;
  canManageAnyAvailability: boolean;
  canApproveAvailability: boolean;
}

export function buildOneTimeOrderCapabilities(params: {
  subject?: AccessSubject;
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
  order: {
    id?: string;
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

  const legacy = {
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
    canRegisterPayments: canEditOperationalFields,
    canManageManagers,
    // Execution actions on individual specification items belong only to a
    // user actively assigned as the order's one_time_manager.
    canManageSpecification: isActiveManager,
    // Structural changes to a work specification are a leadership-only
    // contract. Keep canManageSpecification as the existing execution-scope
    // signal so assigned managers retain R2 completion and attachment flows.
    canEditSpecification: params.roleCodes.some((role) =>
      ['founder', 'deputy_founder', 'director', 'corporate_director'].includes(role),
    ),
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
    canDeleteReview: hasOneTimeOrderPermission(
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
  const subject = params.subject ?? { id: params.currentUserId, roleCodes: params.roleCodes, permissionCodes: params.permissionCodes };
  const context = { resourceType: 'one_time_order', resourceId: params.order.id, ownerUserId: params.order.createdByUserId,
    assignedUserIds: params.order.assignments.filter(a => a.isActive !== false && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId) };
  const mapping: Partial<Record<keyof typeof legacy, string>> = {
    canEdit: 'one_time_orders.update', canEditOperationalFields: 'one_time_orders.update', canEditFinancialFields: 'one_time_orders.update',
    canChangeLinkedObject: 'one_time_orders.update', canChangeStatus: 'one_time_orders.status', canComplete: 'one_time_orders.complete',
    canReopen: 'one_time_orders.reopen', canCorrectPayments: 'one_time_orders.payments.correct', canManageManagers: 'one_time_orders.managers.manage',
    canRegisterPayments: 'one_time_orders.payments.create',
    canManageSpecification: 'one_time_orders.specification.execute', canEditSpecification: 'one_time_orders.specification.manage',
    canUploadPhotos: 'one_time_orders.photos.create', canDeletePhotos: 'one_time_orders.photos.delete', canRestorePhotos: 'one_time_orders.photos.restore',
    canComment: 'one_time_orders.comments.create', canEditReview: 'one_time_orders.review.edit', canCopy: 'one_time_orders.copy',
    canDeleteReview: 'one_time_orders.review.delete',
  };
  for (const [key, action] of Object.entries(mapping)) {
    const capability = key as keyof typeof legacy;
    legacy[capability] = decideAccess(subject, action, legacy[capability], { ...context,
      ...(capability === 'canManageSpecification' ? { invariantAllowed: isActiveManager && !['completed','cancelled'].includes(params.order.status) } : {}),
    });
  }
  // Lifecycle checks remain mandatory even with an explicit grant.
  legacy.canChangeStatus &&= params.order.status !== 'completed';
  legacy.canComplete &&= !['completed', 'cancelled'].includes(params.order.status);
  legacy.canReopen &&= params.order.status === 'completed';
  const canReadOrder = decideAccess(subject, 'one_time_orders.read', hasFullAccess || isCreator || isActiveManager, context);
  const readLeaf = (actionCode: string) => canReadOrder && decideAccess(subject, actionCode, true, context);
  const canReadFinance = readLeaf('one_time_orders.finance.read');
  const canReadPayouts = canReadFinance && readLeaf('one_time_orders.payouts.read');
  const open = !['completed', 'cancelled'].includes(params.order.status);
  const canReadEmployees = readLeaf('one_time_orders.employees.read');
  const ownAccountContext = { resourceType: 'user', resourceId: params.currentUserId, ownerUserId: params.currentUserId };
  return {
    ...legacy,
    canReadFinance,
    canReadComments: readLeaf('one_time_orders.comments.read'),
    canReadReports: readLeaf('one_time_orders.reports.read'),
    canReadPhotos: readLeaf('one_time_orders.photos.read'),
    canReadSpecification: readLeaf('one_time_orders.specification.read'),
    canReadEmployees,
    // Scoped order inventory does not depend on global catalog-read permission.
    canReadInventory: readLeaf('one_time_orders.inventory.read') && !hasModuleDeny(subject, 'inventory.access', context),
    canReadEquipment: readLeaf('one_time_orders.equipment.read') && !hasModuleDeny(subject, 'equipment.read', context),
    canReadHistory: readLeaf('one_time_orders.history'),
    // No file/task exists yet at projection time. Their global denies apply here;
    // resource-level scopes remain enforced by each listing and direct endpoint.
    canReadFiles: canReadOrder && !hasModuleDeny(subject, 'files.read', context),
    canReadTasks: canReadOrder && !hasModuleDeny(subject, 'tasks.read', context),
    canReadAccountability: canReadPayouts && decideAccess(subject, 'accountability.order_summary.read', true, ownAccountContext) && !hasModuleDeny(subject, 'accountability.read', ownAccountContext),
    canReadPayouts,
    canUpdateReports: canReadOrder && decideAccess(subject, 'one_time_orders.reports.update', canEditOperationalFields, context),
    canReadEscorts: canReadEmployees,
    canManageOwnEscorts: canReadEmployees && open && decideAccess(subject, 'one_time_orders.escorts.manage', params.permissionCodes?.includes('one_time_order.escorts.manage') === true, context),
    canReadDeadline: canReadOrder,
    canUpdateDeadline: canReadOrder && legacy.canEditOperationalFields && open,
    canReadServiceLines: canReadFinance,
    canUpdateServiceLines: canReadFinance && legacy.canEditFinancialFields && open,
  };
}

export function canOpenLinkedObjectCard(params: {
  subject?: AccessSubject;
  currentUserId: string;
  roleCodes: string[];
  linkedObject?: {
    id?: string;
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
    subject: params.subject,
    currentUserId: params.currentUserId,
    roleCodes: params.roleCodes,
    object: params.linkedObject,
  });
}
