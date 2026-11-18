import type { PrismaService } from '../prisma/prisma.service';
import type { AccessSubject, AccessRule } from '../users-access/types/access-policy.type';
import { decideAccess, hasModuleDeny } from '../users-access/utils/access-policy.util';
import { canEditObject, canManageObjectResponsibles, canViewObjectByScope } from '../objects/utils/object-access.util';
import { canAssignEquipmentToObject } from '../equipment/utils/equipment-access.util';
import { hasWideTaskAccess } from '../tasks/utils/task-access.util';
import type { ObjectDelegatedAction, ObjectDelegationGrant } from './object-delegation.context';

/** Fresh readonly grant snapshot shared by HTTP and background visibility batches.
 * No audit, DI, context installation or role/identity substitution. */
export async function resolveObjectDelegationGrants(prisma: Pick<PrismaService, 'userSubstitution'>, actorUserId: string): Promise<ObjectDelegationGrant[]> {
  const now = new Date();
  const records = await prisma.userSubstitution.findMany({
    where: {
      replacementUserId: actorUserId, revokedAt: null,
      startsAt: { lte: now }, endsAt: { gt: now },
      replacement: { isActive: true, deletedAt: null },
      principal: { isActive: true, deletedAt: null },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      principal: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, permissions: { include: { permission: true } }, accessRules: true } },
      replacement: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } }, permissions: { include: { permission: true } }, accessRules: true } },
      objects: { include: { object: { include: { assignments: { where: { isActive: true } } } } } },
    },
  });
  const grants: ObjectDelegationGrant[] = [];
  for (const record of records) {
    const roles = record.principal.roles.map((entry) => entry.role.code);
    const subject = (user: typeof record.principal): AccessSubject => ({
      id: user.id, isActive: user.isActive, roleCodes: user.roles.map(entry => entry.role.code),
      permissionCodes: [...new Set([...user.permissions.map(entry => entry.permission.code), ...user.roles.flatMap(entry => entry.role.permissions.map(grant => grant.permission.code))])],
      accessRules: user.accessRules.map(rule => ({ ...rule, effect: rule.effect as AccessRule['effect'], scope: rule.scope as AccessRule['scope'] })),
    });
    const principal = subject(record.principal), replacement = subject(record.replacement);
    for (const scope of record.objects) {
      const context = { resourceType: 'object', resourceId: scope.objectId, ownerUserId: scope.object.createdByUserId, assignedUserIds: scope.object.assignments.map(a => a.userId) };
      const legacyView = canViewObjectByScope({ currentUserId: record.principalUserId, roleCodes: roles, object: scope.object, ownScopeOnly: true });
      if (scope.object.deletedAt || !decideAccess(principal, 'objects.read', legacyView, context) || hasModuleDeny(replacement, 'objects.read', context)) continue;
      const actions: ObjectDelegatedAction[] = ['view', 'operate'];
      if (decideAccess(principal, 'inventory.issue_to_object', true, context) && !hasModuleDeny(replacement, 'inventory.issue_to_object', context)) actions.push('inventory_issue');
      if (decideAccess(principal, 'objects.update', canEditObject(roles), context) && !hasModuleDeny(replacement, 'objects.update', context)) actions.push('edit');
      if (decideAccess(principal, 'objects.responsibles.manage', canManageObjectResponsibles(roles), context) && !hasModuleDeny(replacement, 'objects.responsibles.manage', context)) actions.push('assign');
      if (decideAccess(principal, 'objects.status', canManageObjectResponsibles(roles), context) && !hasModuleDeny(replacement, 'objects.status', context)) actions.push('status');
      if (canAssignEquipmentToObject(roles) && !hasModuleDeny(principal, 'equipment.assign_object') && !hasModuleDeny(replacement, 'equipment.assign_object')) actions.push('equipment_move');
      grants.push({ substitutionId: record.id, principalUserId: record.principalUserId, objectId: scope.objectId, actions, endsAt: record.endsAt.getTime(), taskWideAccess: hasWideTaskAccess(roles), principalSubject: principal, replacementSubject: replacement, objectPolicyContext: context });
    }
  }
  return grants;
}
