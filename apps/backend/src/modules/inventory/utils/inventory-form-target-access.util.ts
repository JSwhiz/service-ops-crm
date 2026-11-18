import { canViewObjectBasicProfile } from '../../objects/utils/object-access.util';
import { canViewOneTimeOrderByScope } from '../../one-time-orders/utils/one-time-order-access.util';
import { hasDelegatedObjectAction } from '../../user-substitutions/object-delegation.context';
import { AccessContext, AccessSubject, decideAccess, hasModuleDeny } from '../../users-access/utils/access-policy.util';
import { canIssueInventoryToObject, canIssueInventoryToOneTimeOrder } from './inventory-access.util';

export interface InventoryFormObjectTarget {
  id: string; createdByUserId: string; deletedAt?: Date | null;
  assignments: Array<{ userId: string; isActive: boolean }>;
}
export interface InventoryFormOrderTarget {
  id: string; status: string; createdByUserId: string;
  assignments: Array<{ userId: string; assignmentRoleCode: string; isActive: boolean }>;
}
const rolesOf = (user: AccessSubject) => [...(user.roleCodes?.length ? user.roleCodes : (user.roleCode ? [user.roleCode] : []))];
const objectContext = (object: InventoryFormObjectTarget): AccessContext => ({
  resourceType: 'object', resourceId: object.id, ownerUserId: object.createdByUserId,
  assignedUserIds: object.assignments.filter(a => a.isActive).map(a => a.userId),
});
const orderContext = (order: InventoryFormOrderTarget): AccessContext => ({
  resourceType: 'one_time_order', resourceId: order.id, ownerUserId: order.createdByUserId,
  assignedUserIds: order.assignments.filter(a => a.isActive && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId),
});

/** Read-only target checks, shared by generic POST prechecks and reference DTOs.
 * Item permissions, stock, evidence and payload validity remain separate gates. */
export function canReadInventoryObjectTarget(user: AccessSubject, object: InventoryFormObjectTarget): boolean {
  const context = objectContext(object);
  const own = canViewObjectBasicProfile({ subject: user, currentUserId: user.id, roleCodes: rolesOf(user),
    permissionCodes: [...(user.permissionCodes ?? [])], ownScopeOnly: true, object });
  return !object.deletedAt && decideAccess(user, 'objects.read', own ||
    hasDelegatedObjectAction(user.id, object.id, 'view', false, 'objects.read', context), context);
}
export function canUseInventoryObjectIssueTarget(user: AccessSubject, object: InventoryFormObjectTarget): boolean {
  const context = objectContext(object);
  return canReadInventoryObjectTarget(user, object) && decideAccess(user, 'objects.inventory.issue', true, {
    ...context, parents: [{ actionCode: 'objects.read', context }],
  });
}
export function inventoryObjectFormCapabilities(user: AccessSubject, object: InventoryFormObjectTarget) {
  const context = objectContext(object);
  return { canIssueToObject: canUseInventoryObjectIssueTarget(user, object) && decideAccess(user, 'inventory.issue_to_object',
    canIssueInventoryToObject(rolesOf(user)), { ...context, parents: [
      { actionCode: 'objects.read', context }, { actionCode: 'objects.inventory.issue', context },
    ] }) };
}
export function inventoryOrderFormCapabilities(user: AccessSubject, order: InventoryFormOrderTarget) {
  const context = orderContext(order);
  const readable = canViewOneTimeOrderByScope({ subject: user, currentUserId: user.id, roleCodes: rolesOf(user),
    permissionCodes: [...(user.permissionCodes ?? [])], order });
  // A generic link requires actual order read. It is not an order inventory
  // operation grant, but existing negative inventory-section ancestors still win.
  const canLinkMovement = readable && !hasModuleDeny(user, 'one_time_orders.inventory.read', context) &&
    decideAccess(user, 'inventory.access', true, context);
  const globalIssuer = canIssueInventoryToOneTimeOrder(rolesOf(user));
  return { canLinkMovement, canIssueToOneTimeOrder: canLinkMovement && globalIssuer &&
    !['completed', 'cancelled'].includes(order.status) && decideAccess(user, 'inventory.issue_to_one_time_order', globalIssuer, {
      ...context, parents: [{ actionCode: 'one_time_orders.read', context }],
    }) };
}
