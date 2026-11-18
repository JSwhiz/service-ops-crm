import { Prisma } from '@prisma/client';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { buildAccessWhere } from '../users-access/utils/access-policy.util';
import { hasWideObjectAccess } from '../objects/utils/object-access.util';
import { delegatedObjectScopes } from '../user-substitutions/object-delegation.context';

/** Object identity is also the identity of a quantity account. Grants only add
 * the legacy delegated object; both snapshots subtract leaf/ancestor denies. */
export function matObjectPolicyWhere(user: AccessSubject, code = 'mats.read'): Prisma.ObjectWhereInput {
  const policy = (subject: AccessSubject, legacyWhere: Prisma.ObjectWhereInput) => buildAccessWhere<Prisma.ObjectWhereInput>({
    subject, actionCode: code, legacyWhere, invariantWhere: { deletedAt: null },
    parentActionCodes: ['objects.read', 'objects.access'],
    scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
      : rule.scope === 'own' ? { createdByUserId: subject.id } : { assignments: { some: { userId: subject.id, isActive: true } } },
  }) as Prisma.ObjectWhereInput;
  const roles = user.roleCodes ?? (user.roleCode ? [user.roleCode] : []);
  const legacy: Prisma.ObjectWhereInput = hasWideObjectAccess([...roles]) ? {} : { OR: [
    { createdByUserId: user.id }, { assignments: { some: { userId: user.id, isActive: true } } },
    ...delegatedObjectScopes(user.id).map(grant => ({ AND: [
      { id: grant.objectId },
      ...[grant.principalSubject, grant.replacementSubject].filter((s): s is AccessSubject => !!s).map(subject => policy(subject, {})),
    ] })),
  ] };
  return policy(user, legacy);
}
