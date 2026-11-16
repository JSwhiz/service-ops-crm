import { delegatedObjectIds, hasDelegatedObjectAction } from '../../user-substitutions/object-delegation.context';
import { Prisma } from '@prisma/client';
import { AccessSubject, buildAccessWhere, decideAccess } from '../../users-access/utils/access-policy.util';

export function buildObjectAccessPolicyWhere(subject: AccessSubject, legacyWhere: Prisma.ObjectWhereInput, actionCode = 'objects.read'): Prisma.ObjectWhereInput {
  return buildAccessWhere<Prisma.ObjectWhereInput>({ subject, actionCode, legacyWhere,
    invariantWhere: { deletedAt: null }, scopeWhere: rule => {
      if (rule.scope === 'all') return {};
      if (rule.scope === 'selected') return { id: { in: [...rule.selectedIds] } };
      if (rule.scope === 'own') return { createdByUserId: subject.id };
      return { assignments: { some: { userId: subject.id, isActive: true } } };
    },
  }) as Prisma.ObjectWhereInput;
}

export const LEADERSHIP_OBJECT_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
] as const;

export const OBJECT_MANAGER_ROLE_CODES = [
  'manager',
  'senior_manager',
  'operation_manager',
  'director',
  'deputy_director',
  'corporate_director',
  'founder',
  'deputy_founder',
] as const;

export const WIDE_OBJECT_ACCESS_ROLES = [
  ...LEADERSHIP_OBJECT_ROLE_CODES,
  'deputy_director',
] as const;

export const OBJECT_EDIT_ROLES = LEADERSHIP_OBJECT_ROLE_CODES;

export const OBJECT_DAILY_RATE_EDIT_ROLES = [
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
  // Deputy director receives only rate-management rights here; this does not
  // add the role to the leadership circle or grant object-core edit access.
  'deputy_director',
] as const;

// A narrower, legacy permission for entering an exceptional rate on an
// attendance fact. Managing the reusable compensation catalog must not grant
// authority to rewrite monetary facts.
export const OBJECT_ATTENDANCE_RATE_OVERRIDE_ROLES = [
  'founder',
  'director',
] as const;

export const FROZEN_OBJECT_OVERRIDE_ROLES = [
  'founder',
  'director',
] as const;

export const OBJECT_HR_VIEW_PERMISSION_CODE = 'objects.view_hr';

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((role) => allowed.includes(role as never));
}

export function hasWideObjectAccess(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, WIDE_OBJECT_ACCESS_ROLES);
}

export function canCreateObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES);
}

export function canEditObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_EDIT_ROLES);
}

export function canEditObjectDailyRate(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_DAILY_RATE_EDIT_ROLES);
}

export function canViewObjectCompensationRates(params: {
  subject?: AccessSubject;
  currentUserId: string;
  roleCodes: string[];
  object: {
    id?: string;
    createdByUserId: string;
    assignments: Array<{ userId: string; isActive?: boolean }>;
  };
}): boolean {
  const legacyRateRead = canEditObjectDailyRate(params.roleCodes) || canViewObjectByScope({
    currentUserId: params.currentUserId,
    roleCodes: params.roleCodes,
    object: params.object,
  });
  return decideAccess(params.subject ?? { id: params.currentUserId }, 'objects.rates.read', legacyRateRead, {
    resourceType: 'object', resourceId: params.object.id, ownerUserId: params.object.createdByUserId,
    assignedUserIds: params.object.assignments.filter(a => a.isActive !== false).map(a => a.userId),
  });
}

export function canOverrideObjectAttendanceRate(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_ATTENDANCE_RATE_OVERRIDE_ROLES);
}

export function canOverrideFrozenObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, FROZEN_OBJECT_OVERRIDE_ROLES);
}

export function canManageObjectResponsibles(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES);
}

export function canBeObjectManager(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_MANAGER_ROLE_CODES);
}

export function hasHrObjectView(permissionCodes: string[] = []): boolean {
  return permissionCodes.includes(OBJECT_HR_VIEW_PERMISSION_CODE);
}

/** SQL equivalent of basic-card visibility, including HR and delegation.
 * A count must not use an unrestricted legacy baseline while its list is scoped. */
export function buildObjectBasicProfileAccessWhere(params: {
  subject: AccessSubject;
  roleCodes: string[];
  permissionCodes?: string[];
}): Prisma.ObjectWhereInput {
  const { subject } = params;
  const operational = buildObjectAccessPolicyWhere(subject, hasWideObjectAccess(params.roleCodes) ? {} : {
    OR: [
      { createdByUserId: subject.id },
      { assignments: { some: { userId: subject.id, isActive: true } } },
      { id: { in: delegatedObjectIds(subject.id, 'view', 'objects.read') } },
    ],
  });
  const hr = buildObjectAccessPolicyWhere(subject,
    hasHrObjectView(params.permissionCodes) ? {} : { id: { in: [] } }, 'objects.view_hr');
  return { AND: [{ OR: [operational, hr] }, buildObjectAccessPolicyWhere(subject, {}, 'objects.read')] };
}

export function canViewObjectByScope(params: {
  subject?: AccessSubject;
  currentUserId: string;
  roleCodes: string[];
  ownScopeOnly?: boolean;
  object: {
    id?: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      isActive?: boolean;
    }>;
  };
}): boolean {
  const context = { resourceType: 'object', resourceId: params.object.id, ownerUserId: params.object.createdByUserId,
    assignedUserIds: params.object.assignments.filter(a => a.isActive !== false).map(a => a.userId) };
  const legacy = hasWideObjectAccess(params.roleCodes) || params.object.createdByUserId === params.currentUserId || params.object.assignments.some(
    (assignment) =>
      assignment.userId === params.currentUserId &&
      assignment.isActive !== false,
  ) || (!params.ownScopeOnly && hasDelegatedObjectAction(params.currentUserId, params.object.id, 'view', true, 'objects.read', context));
  return decideAccess(params.subject ?? { id: params.currentUserId }, 'objects.read', legacy, context);
}

export function canViewObjectBasicProfile(params: {
  subject?: AccessSubject;
  currentUserId: string;
  roleCodes: string[];
  permissionCodes?: string[];
  ownScopeOnly?: boolean;
  object: {
    id?: string;
    createdByUserId: string;
    assignments: Array<{
      userId: string;
      isActive?: boolean;
    }>;
  };
}): boolean {
  const context = { resourceType: 'object', resourceId: params.object.id, ownerUserId: params.object.createdByUserId,
    assignedUserIds: params.object.assignments.filter(a => a.isActive !== false).map(a => a.userId) };
  return decideAccess(params.subject ?? { id: params.currentUserId }, 'objects.read', (
    decideAccess(params.subject ?? { id: params.currentUserId }, 'objects.view_hr', hasHrObjectView(params.permissionCodes), context) ||
    canViewObjectByScope({
      currentUserId: params.currentUserId,
      subject: params.subject,
      roleCodes: params.roleCodes,
      ownScopeOnly: params.ownScopeOnly,
      object: params.object,
    })
  ), context);
}
