import type { Prisma } from '@prisma/client';
import { canAccessInventory, canViewInventoryReports } from '../../modules/inventory/utils/inventory-access.util';
import { buildObjectBasicProfileAccessWhere } from '../../modules/objects/utils/object-access.util';
import { buildOneTimeOrderAccessWhere } from '../../modules/one-time-orders/utils/one-time-order-access.util';
import { buildAccessWhere } from '../../modules/users-access/utils/access-policy.util';
import type { AccessSubject } from '../../modules/users-access/types/access-policy.type';

/** Shared by movement queries and notification source membership. A scoped
 * baseline is supplied only by a caller that has independently checked scope. */
export function inventoryMovementVisibilityWhere(
  subject: AccessSubject,
  actionCode: string,
  scopedLegacyWhere?: Prisma.InventoryMovementWhereInput,
): Prisma.InventoryMovementWhereInput {
  const roles = [...(subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []))];
  const permissions = [...(subject.permissionCodes ?? [])];
  const legacyWhere = canAccessInventory(roles) ? {} : scopedLegacyWhere ?? { id: { in: [] } };
  const policy = (code: string) => buildAccessWhere<Prisma.InventoryMovementWhereInput>({
    subject,
    actionCode: code,
    legacyWhere: code === 'inventory.reports' && !canViewInventoryReports(roles)
      ? { id: { in: [] } }
      : legacyWhere,
    invariantWhere: {},
    scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected'
      ? { inventoryItemId: { in: [...rule.selectedIds] } } : null,
  }) as Prisma.InventoryMovementWhereInput;
  const objectWhere = buildObjectBasicProfileAccessWhere({ subject, roleCodes: roles, permissionCodes: permissions });
  const orderWhere = buildOneTimeOrderAccessWhere({ subject, currentUserId: subject.id, roleCodes: roles, permissionCodes: permissions });
  return { AND: [policy(actionCode), policy('inventory.read'),
    { OR: [{ relatedObjectId: null }, { relatedObject: objectWhere }] },
    { OR: [{ relatedOneTimeOrderId: null }, { relatedOneTimeOrder: orderWhere }] },
  ] };
}
