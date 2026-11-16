import type { Prisma } from '@prisma/client';
import type { AccessContext, AccessSubject } from '../../users-access/types/access-policy.type';
import { buildAccessWhere } from '../../users-access/utils/access-policy.util';
import type { EquipmentMovementType, EquipmentUnitPolicyFacts } from '../types/equipment.type';

export const equipmentMovementAction: Record<EquipmentMovementType, string> = {
  issue_to_object: 'equipment.assign_object', issue_to_one_time_order: 'equipment.assign_order', return_to_storage: 'equipment.return',
  send_to_repair: 'equipment.repair', return_from_repair: 'equipment.repair_return', mark_broken: 'equipment.broken', mark_lost: 'equipment.lost', writeoff: 'equipment.writeoff',
};

interface WorkScope { id: string; createdByUserId: string; assignments: Array<{ userId: string; isActive?: boolean }> }
export function equipmentContext(unit: EquipmentUnitPolicyFacts & { currentObject?: WorkScope | null; currentOneTimeOrder?: WorkScope | null }): AccessContext {
  const targets = [
    ...(unit.currentObject ? [{ actionCode: 'objects.read', row: unit.currentObject, resourceType: 'object' }] : []),
    ...(unit.currentOneTimeOrder ? [{ actionCode: 'one_time_orders.read', row: unit.currentOneTimeOrder, resourceType: 'one_time_order' }] : []),
  ];
  return { resourceType: 'equipment_unit', resourceId: unit.id, ownerUserId: unit.createdByUserId, parents: targets.map(({ actionCode, row, resourceType }) => ({
    actionCode, context: { resourceType, resourceId: row.id, ownerUserId: row.createdByUserId, assignedUserIds: row.assignments.filter(a => a.isActive !== false).map(a => a.userId) },
  })) };
}

export function equipmentPolicyWhere(subject: AccessSubject, legacyWhere: Prisma.EquipmentUnitWhereInput, actionCode = 'equipment.read'): Prisma.EquipmentUnitWhereInput {
  return buildAccessWhere<Prisma.EquipmentUnitWhereInput>({
    subject, actionCode, legacyWhere, invariantWhere: {},
    parentActionCodes: ['objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read'],
    scopeWhere: (rule, code) => {
      const object = code.startsWith('objects.');
      if (object || code.startsWith('one_time_orders.')) {
        if (rule.scope === 'all') return object ? { currentObjectId: { not: null } } : { currentOneTimeOrderId: { not: null } };
        const scope = rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : rule.scope === 'own' ? { createdByUserId: subject.id }
          : { assignments: { some: { userId: subject.id, isActive: true } } };
        return object ? { currentObject: scope } : { currentOneTimeOrder: scope };
      }
      return rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : null;
    },
  }) as Prisma.EquipmentUnitWhereInput;
}

export function equipmentMovementPolicyWhere(subject: AccessSubject): Prisma.EquipmentMovementWhereInput {
  return buildAccessWhere<Prisma.EquipmentMovementWhereInput>({
    subject, actionCode: 'equipment.history', legacyWhere: {}, invariantWhere: {},
    parentActionCodes: ['objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read'],
    scopeWhere: (rule, code) => {
      const object = code.startsWith('objects.');
      if (object || code.startsWith('one_time_orders.')) {
        const from = object ? 'fromObject' : 'fromOneTimeOrder', to = object ? 'toObject' : 'toOneTimeOrder';
        const scope = rule.scope === 'all' ? { id: { not: '' } } : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
          : rule.scope === 'own' ? { createdByUserId: subject.id } : { assignments: { some: { userId: subject.id, isActive: true } } };
        return { OR: [{ [from]: scope }, { [to]: scope }] };
      }
      return rule.scope === 'all' ? {} : rule.scope === 'selected' ? { equipmentUnitId: { in: [...rule.selectedIds] } } : null;
    },
  }) as Prisma.EquipmentMovementWhereInput;
}
