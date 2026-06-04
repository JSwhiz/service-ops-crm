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
  'deputy_director',
] as const;

export const ONE_TIME_ORDER_MANAGEMENT_ROLE_CODES = LEADERSHIP_OBJECT_ROLE_CODES;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

function hasActiveOrderAssignment(
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

export function hasOneTimeOrderManagementAccess(
  roleCodes: string[],
): boolean {
  return hasAnyRole(roleCodes, ONE_TIME_ORDER_MANAGEMENT_ROLE_CODES);
}

export function canAccessOneTimeOrders(roleCodes: string[]): boolean {
  return (
    hasWideOneTimeOrderAccess(roleCodes) ||
    hasAnyRole(roleCodes, ONE_TIME_ORDER_MANAGER_ROLE_CODES)
  );
}

export function canCreateOneTimeOrder(roleCodes: string[]): boolean {
  return hasOneTimeOrderManagementAccess(roleCodes);
}

export function canManageOneTimeOrderManagers(roleCodes: string[]): boolean {
  return hasOneTimeOrderManagementAccess(roleCodes);
}

export function canBeOneTimeOrderManager(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, ONE_TIME_ORDER_MANAGER_ROLE_CODES);
}

export function canViewOneTimeOrderByScope(params: {
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
}): boolean {
  if (hasWideOneTimeOrderAccess(params.roleCodes)) {
    return true;
  }

  if (params.order.createdByUserId === params.currentUserId) {
    return true;
  }

  return hasActiveOrderAssignment(params.order, params.currentUserId);
}

export function canEditOneTimeOrderByScope(params: {
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
}): boolean {
  return (
    hasOneTimeOrderManagementAccess(params.roleCodes) ||
    params.order.createdByUserId === params.currentUserId ||
    hasActiveOrderAssignment(params.order, params.currentUserId)
  );
}

export function canCreateTaskOnOneTimeOrder(params: {
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
    hasActiveOrderAssignment(params.order, params.userId)
  );
}
