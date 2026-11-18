import type { Prisma } from '@prisma/client';
import type { AccessRule, AccessSubject } from '../users-access/types/access-policy.type';
import { buildAccessWhere } from '../users-access/utils/access-policy.util';
import { LEADERSHIP_OBJECT_ROLE_CODES } from '../objects/utils/object-access.util';

function userScope(subject: AccessSubject, rule: AccessRule): Prisma.UserWhereInput {
  if (rule.scope === 'all') return {};
  if (rule.scope === 'own') return { id: subject.id };
  if (rule.scope === 'selected') return { id: { in: [...rule.selectedIds] } };
  // A plan's context has no assignment fact. Do not invent one from manager roles.
  return { id: { in: [] } };
}

export function visitPlanManageUserWhere(subject: AccessSubject): Prisma.UserWhereInput {
  return buildAccessWhere<Prisma.UserWhereInput>({
    subject, actionCode: 'visit_plans.manage', invariantWhere: {},
    legacyWhere: subject.permissionCodes?.includes('visit_plans.manage') ? {} : { id: { in: [] } },
    scopeWhere: rule => userScope(subject, rule),
  }) as Prisma.UserWhereInput;
}

/** Target identity is manager User, never plan/entry ID. No active-user/role
 * requirement is imposed on the target beyond the existing read contract.
 * Management denial removes only that path, not independent owner/leadership read. */
export function visitPlanReadUserWhere(subject: AccessSubject): Prisma.UserWhereInput {
  const roles = subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []);
  const leadership = roles.some(role => (LEADERSHIP_OBJECT_ROLE_CODES as readonly string[]).includes(role));
  return buildAccessWhere<Prisma.UserWhereInput>({
    subject, actionCode: 'visit_plans.read', invariantWhere: {},
    legacyWhere: leadership ? {} : { OR: [{ id: subject.id }, visitPlanManageUserWhere(subject)] },
    scopeWhere: rule => userScope(subject, rule),
  }) as Prisma.UserWhereInput;
}
