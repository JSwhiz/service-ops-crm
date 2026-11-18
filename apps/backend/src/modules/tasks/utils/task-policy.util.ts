import type { Prisma } from '@prisma/client';
import { buildAccessWhere } from '../../users-access/utils/access-policy.util';
import type { AccessSubject, AccessRule } from '../../users-access/types/access-policy.type';
import { buildOneTimeOrderAccessWhere } from '../../one-time-orders/utils/one-time-order-access.util';

/** Full interactive task visibility, also reusable by discovery/delivery queries.
 * The legacy task predicate is supplied explicitly to avoid a task-helper cycle.
 * Order visibility is mandatory even for a personal task grant. Object-linked
 * own/assigned tasks keep their legacy independent read path; explicit object
 * ancestor denies are still subtracted by taskPolicyWhere. */
export function taskVisibilityWhere(subject: AccessSubject, legacyTaskWhere: Prisma.TaskWhereInput, actionCode = 'tasks.read'): Prisma.TaskWhereInput {
  const orderReadWhere = buildOneTimeOrderAccessWhere({
    subject,
    currentUserId: subject.id,
    roleCodes: [...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []))],
    permissionCodes: [...(subject.permissionCodes ?? [])],
  });
  return { AND: [
    taskPolicyWhere(subject, legacyTaskWhere, actionCode),
    { OR: [{ oneTimeOrderId: null }, { oneTimeOrder: orderReadWhere }] },
  ] };
}

/** Explicit subject context; legacy helpers remain usable by unrelated consumers. */
export function taskPolicyWhere(subject: AccessSubject, legacyWhere: Prisma.TaskWhereInput, actionCode = 'tasks.read'): Prisma.TaskWhereInput {
  return buildAccessWhere<Prisma.TaskWhereInput>({
    subject, actionCode, legacyWhere, invariantWhere: {},
    parentActionCodes: ['objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read'],
    scopeWhere: (rule: AccessRule, code) => {
      const object = code.startsWith('objects.');
      const order = code.startsWith('one_time_orders.');
      if (object || order) {
        const relation = object ? 'object' : 'oneTimeOrder';
        if (rule.scope === 'all') return object ? { objectId: { not: null } } : { oneTimeOrderId: { not: null } };
        const scope = rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
          : rule.scope === 'own' ? { createdByUserId: subject.id }
            : { assignments: { some: { userId: subject.id, isActive: true } } };
        return { [relation]: scope };
      }
      if (rule.scope === 'all') return {};
      if (rule.scope === 'selected') return { id: { in: [...rule.selectedIds] } };
      if (rule.scope === 'own') return { createdByUserId: subject.id };
      return { assignees: { some: { userId: subject.id, isActive: true } } };
    },
  }) as Prisma.TaskWhereInput;
}
