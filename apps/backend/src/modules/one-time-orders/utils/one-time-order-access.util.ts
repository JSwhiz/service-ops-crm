import { Prisma } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessSubject, buildAccessWhere, decideAccess } from '../../users-access/utils/access-policy.util';

/** Domain adapter: resolve real ownership/assignment facts, then defer to the shared policy. */
export async function assertOneTimeOrderAction(database: Pick<Prisma.TransactionClient, 'oneTimeOrder'>, subject: AccessSubject, orderId: string, actionCode: string): Promise<void> {
  if (!subject.accessRules?.length && subject.isActive !== false) return;
  const order = await database.oneTimeOrder.findUnique({ where: { id: orderId }, select: {
    id: true, createdByUserId: true, assignments: { where: { isActive: true, assignmentRoleCode: 'one_time_manager' }, select: { userId: true } },
  } });
  if (!order) throw new NotFoundException('One-time order not found');
  const context = { resourceType: 'one_time_order', resourceId: order.id, ownerUserId: order.createdByUserId,
    assignedUserIds: order.assignments.map(a => a.userId) };
  if (!decideAccess(subject, 'one_time_orders.read', true, context) || !decideAccess(subject, actionCode, true, context)) throw new ForbiddenException('One-time order action denied');
}

import { LEADERSHIP_OBJECT_ROLE_CODES } from '../../objects/utils/object-access.util';

export const ONE_TIME_ORDER_MANAGER_ROLE_CODES = [
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

export const ONE_TIME_ORDER_ASSIGNMENT_ROLE_CODES = [
  'one_time_manager',
] as const;

export const ONE_TIME_ORDER_FULL_ACCESS_ROLE_CODES = [
  ...LEADERSHIP_OBJECT_ROLE_CODES,
  'deputy_director',
] as const;

export const WIDE_ONE_TIME_ORDER_VIEW_ROLE_CODES =
  ONE_TIME_ORDER_FULL_ACCESS_ROLE_CODES;

export const ONE_TIME_ORDER_MANAGEMENT_ROLE_CODES =
  ONE_TIME_ORDER_FULL_ACCESS_ROLE_CODES;

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
  subject?: AccessSubject;
  legacyWhere?: Prisma.OneTimeOrderWhereInput;
  actionCode?: string;
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
}): Prisma.OneTimeOrderWhereInput {
  const legacyWhere = params.legacyWhere ?? legacyOneTimeOrderAccessWhere(params);
  if (!params.subject) return legacyWhere;
  return buildAccessWhere<Prisma.OneTimeOrderWhereInput>({ subject: params.subject,
    actionCode: params.actionCode ?? 'one_time_orders.read', legacyWhere, invariantWhere: {}, parentActionCodes: ['one_time_orders.read'],
    scopeWhere: rule => {
      if (rule.scope === 'all') return {};
      if (rule.scope === 'selected') return { id: { in: [...rule.selectedIds] } };
      if (rule.scope === 'own') return { createdByUserId: params.currentUserId };
      return { assignments: { some: { userId: params.currentUserId, assignmentRoleCode: 'one_time_manager', isActive: true } } };
    },
  }) as Prisma.OneTimeOrderWhereInput;
}

function legacyOneTimeOrderAccessWhere(params: {
  currentUserId: string; roleCodes: string[]; permissionCodes?: string[];
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
  return (
    hasOneTimeOrderManagementAccess(roleCodes, permissionCodes) ||
    hasAnyRole(roleCodes, ['manager', 'senior_manager'])
  );
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
  subject?: AccessSubject;
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
  order: {
    id?: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive?: boolean;
    }>;
  };
}): boolean {
  const legacy = hasWideOneTimeOrderAccess(params.roleCodes) ||
    hasOneTimeOrderManagementAccess(params.roleCodes, params.permissionCodes) ||
    params.order.createdByUserId === params.currentUserId || hasActiveOneTimeOrderAssignment(params.order, params.currentUserId);
  return decideAccess(params.subject ?? { id: params.currentUserId }, 'one_time_orders.read', legacy, {
    resourceType: 'one_time_order', resourceId: params.order.id, ownerUserId: params.order.createdByUserId,
    assignedUserIds: params.order.assignments.filter(a => a.isActive !== false && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId),
  });
}

export function canEditOneTimeOrderByScope(params: {
  subject?: AccessSubject;
  actionCode?: string;
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
  order: {
    id?: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      assignmentRoleCode: string;
      isActive?: boolean;
    }>;
  };
}): boolean {
  return decideAccess(params.subject ?? { id: params.currentUserId }, params.actionCode ?? 'one_time_orders.update', (
    hasOneTimeOrderManagementAccess(
      params.roleCodes,
      params.permissionCodes,
    ) ||
    params.order.createdByUserId === params.currentUserId ||
    hasActiveOneTimeOrderAssignment(params.order, params.currentUserId)
  ), { resourceType: 'one_time_order', resourceId: params.order.id, ownerUserId: params.order.createdByUserId,
    assignedUserIds: params.order.assignments.filter(a => a.isActive !== false && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId),
    parentAllowed: canViewOneTimeOrderByScope(params) });
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
