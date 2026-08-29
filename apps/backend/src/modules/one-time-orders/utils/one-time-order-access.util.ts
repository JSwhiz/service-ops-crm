import { Prisma } from '@prisma/client';

import { LEADERSHIP_OBJECT_ROLE_CODES } from '../../objects/utils/object-access.util';

export const ONE_TIME_ORDER_MANAGER_ROLE_CODES = [
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

export const ONE_TIME_ORDER_ASSIGNMENT_ROLE_CODES = [
  'one_time_manager',
] as const;

export const WIDE_ONE_TIME_ORDER_VIEW_ROLE_CODES = [
  ...LEADERSHIP_OBJECT_ROLE_CODES,
] as const;

export const ONE_TIME_ORDER_MANAGEMENT_ROLE_CODES = LEADERSHIP_OBJECT_ROLE_CODES;

export const ONE_TIME_ORDER_REVIEW_EDIT_PERMISSION =
  'one_time_order.review.edit';
export const ONE_TIME_ORDER_REVIEW_VIEW_ALL_PERMISSION =
  'one_time_order.review.view_all';
export const ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION =
  'one_time_order.calendar.approve_availability';
export const ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION =
  'one_time_order.calendar.manage';
export const ONE_TIME_ORDER_MANAGE_ALL_PERMISSION =
  'one_time_order.manage_all';

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

export function hasActiveOneTimeOrderAssignment(
  order: {
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive?: boolean;
    }>;
  },
  userId: string,
): boolean {
  return order.assignments.some(
    (assignment) =>
      assignment.userId === userId &&
      assignment.isActive !== false &&
      ONE_TIME_ORDER_ASSIGNMENT_ROLE_CODES.includes(
        assignment.assignmentRoleCode as never,
      ),
  );
}

export function hasWideOneTimeOrderAccess(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, WIDE_ONE_TIME_ORDER_VIEW_ROLE_CODES);
}

export function hasOneTimeOrderPermission(
  permissionCodes: string[] | undefined,
  permissionCode: string,
): boolean {
  return (permissionCodes ?? []).includes(permissionCode);
}

export function hasOneTimeOrderManagementAccess(
  roleCodes: string[],
  permissionCodes?: string[],
): boolean {
  return (
    hasAnyRole(roleCodes, ONE_TIME_ORDER_MANAGEMENT_ROLE_CODES) ||
    hasOneTimeOrderPermission(
      permissionCodes,
      ONE_TIME_ORDER_MANAGE_ALL_PERMISSION,
    )
  );
}

export function buildOneTimeOrderAccessWhere(params: {
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
}): Prisma.OneTimeOrderWhereInput {
  if (
    hasWideOneTimeOrderAccess(params.roleCodes) ||
    hasOneTimeOrderManagementAccess(
      params.roleCodes,
      params.permissionCodes,
    )
  ) {
    return {};
  }

  return {
    OR: [
      { createdByUserId: params.currentUserId },
      {
        assignments: {
          some: {
            userId: params.currentUserId,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        },
      },
    ],
  };
}

export function canAccessOneTimeOrders(
  roleCodes: string[],
  permissionCodes?: string[],
): boolean {
  return (
    hasOneTimeOrderManagementAccess(roleCodes, permissionCodes) ||
    hasWideOneTimeOrderAccess(roleCodes) ||
    hasAnyRole(roleCodes, ONE_TIME_ORDER_MANAGER_ROLE_CODES)
  );
}

export function canCreateOneTimeOrder(
  roleCodes: string[],
  permissionCodes?: string[],
): boolean {
  return hasOneTimeOrderManagementAccess(roleCodes, permissionCodes);
}

export function canManageOneTimeOrderManagers(
  roleCodes: string[],
  permissionCodes?: string[],
): boolean {
  return hasOneTimeOrderManagementAccess(roleCodes, permissionCodes);
}

export function canBeOneTimeOrderManager(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, ONE_TIME_ORDER_MANAGER_ROLE_CODES);
}

export function canViewOneTimeOrderByScope(params: {
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
}): boolean {
  if (
    hasWideOneTimeOrderAccess(params.roleCodes) ||
    hasOneTimeOrderManagementAccess(params.roleCodes, params.permissionCodes)
  ) {
    return true;
  }

  if (params.order.createdByUserId === params.currentUserId) {
    return true;
  }

  return hasActiveOneTimeOrderAssignment(params.order, params.currentUserId);
}

export function canEditOneTimeOrderByScope(params: {
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
}): boolean {
  return (
    hasOneTimeOrderManagementAccess(
      params.roleCodes,
      params.permissionCodes,
    ) ||
    params.order.createdByUserId === params.currentUserId ||
    hasActiveOneTimeOrderAssignment(params.order, params.currentUserId)
  );
}

export function canCreateTaskOnOneTimeOrder(params: {
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
}): boolean {
  return canViewOneTimeOrderByScope(params);
}

export function canAssignTaskToUserOnOneTimeOrder(params: {
  userId: string;
  roleCodes: string[];
  order: {
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive?: boolean;
    }>;
  };
}): boolean {
  return (
    hasWideOneTimeOrderAccess(params.roleCodes) ||
    hasActiveOneTimeOrderAssignment(params.order, params.userId)
  );
}
