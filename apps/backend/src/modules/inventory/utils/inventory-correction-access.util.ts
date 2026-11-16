import { canViewObjectBasicProfile, hasWideObjectAccess } from '../../objects/utils/object-access.util';
import { canViewOneTimeOrderByScope, hasActiveOneTimeOrderAssignment, hasOneTimeOrderManagementAccess } from '../../one-time-orders/utils/one-time-order-access.util';
import { hasDelegatedObjectAction } from '../../user-substitutions/object-delegation.context';
import { AccessContext, AccessSubject, decideAccess } from '../../users-access/utils/access-policy.util';
import { canAccessInventory, canCreateInventoryMovement, canIssueInventoryToObject } from './inventory-access.util';

export interface InventoryCorrectionSource {
  inventoryItemId: string;
  movementType: string;
  status: string;
  relatedObject: {
    id: string; status: string; deletedAt: Date | null; createdByUserId: string;
    assignments: Array<{ userId: string; isActive: boolean }>;
  } | null;
  relatedOneTimeOrder: {
    id: string; status: string; createdByUserId: string;
    assignments: Array<{ userId: string; assignmentRoleCode: string; isActive: boolean }>;
  } | null;
}

/** No IO; projection is side-effect-free by default. The locked POST records
 * only delegation actually required by its successful authorization.
 * Issue grants/denies are not correction grants/denies. Historical role, creator,
 * active assignment and delegation baselines remain separate from personal ACL. */
export function authorizeInventoryCorrection(user: AccessSubject, source: InventoryCorrectionSource, recordUsage = false): boolean {
  if (user.isActive === false) return false;
  const roles = [...(user.roleCodes?.length ? user.roleCodes : (user.roleCode ? [user.roleCode] : []))];
  const permissions = [...(user.permissionCodes ?? [])];
  const parents: NonNullable<AccessContext['parents']>[number][] = [];
  const itemContext: AccessContext = { resourceType: 'inventory_item', resourceId: source.inventoryItemId, parents };
  const globalOperator = canCreateInventoryMovement(roles);
  let objectBaseline = false;
  let ownObjectBaseline = false;
  let delegatedReadContext: AccessContext | undefined;
  let delegatedCorrection = false;
  let objectReadable = false;
  let orderBaseline = false;
  let orderReadable = false;
  if (source.relatedObject) {
    const object = source.relatedObject;
    const context: AccessContext = { resourceType: 'object', resourceId: object.id, ownerUserId: object.createdByUserId,
      assignedUserIds: object.assignments.filter(a => a.isActive).map(a => a.userId) };
    parents.push({ actionCode: 'objects.read', context });
    const ownRead = canViewObjectBasicProfile({
      subject: user, currentUserId: user.id, roleCodes: roles, permissionCodes: permissions, ownScopeOnly: true, object,
    });
    const delegatedView = !ownRead && hasDelegatedObjectAction(user.id, object.id, 'view', false, 'objects.read', context);
    objectReadable = !object.deletedAt && decideAccess(user, 'objects.read', ownRead || delegatedView, context);
    if (!ownRead && delegatedView) delegatedReadContext = context;
    if (!objectReadable || (object.status !== 'active' && !roles.some(role => ['founder', 'director'].includes(role)))) return false;
    ownObjectBaseline = canIssueInventoryToObject(roles) || hasWideObjectAccess(roles) || object.createdByUserId === user.id ||
      object.assignments.some(a => a.isActive && a.userId === user.id);
    delegatedCorrection = !ownObjectBaseline && hasDelegatedObjectAction(user.id, object.id, 'inventory_issue', false, 'inventory.movement.correct', itemContext);
    objectBaseline = ownObjectBaseline || delegatedCorrection;
  }
  if (source.relatedOneTimeOrder) {
    const order = source.relatedOneTimeOrder;
    const context: AccessContext = { resourceType: 'one_time_order', resourceId: order.id, ownerUserId: order.createdByUserId,
      assignedUserIds: order.assignments.filter(a => a.isActive && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId) };
    parents.push({ actionCode: 'one_time_orders.read', context });
    orderReadable = canViewOneTimeOrderByScope({ subject: user, currentUserId: user.id, roleCodes: roles, permissionCodes: permissions, order });
    if (!orderReadable) return false;
    const open = !['completed', 'cancelled'].includes(order.status);
    orderBaseline = open && (hasOneTimeOrderManagementAccess(roles, permissions) || order.createdByUserId === user.id || hasActiveOneTimeOrderAssignment(order, user.id));
    // Preserve global operators' historical closed-order behavior. A personal
    // correction grant alone cannot remove the scoped order lifecycle constraint.
    if (!open && !globalOperator && !objectBaseline) return false;
  }
  if (!decideAccess(user, 'inventory.read', canAccessInventory(roles) || objectReadable || orderReadable, itemContext)) return false;
  const ownCorrection = decideAccess(user, 'inventory.movement.correct', globalOperator || ownObjectBaseline || orderBaseline, itemContext);
  const allowed = ownCorrection || decideAccess(user, 'inventory.movement.correct', globalOperator || objectBaseline || orderBaseline, itemContext);
  if (allowed && recordUsage && source.relatedObject) {
    if (delegatedReadContext) hasDelegatedObjectAction(user.id, source.relatedObject.id, 'view', true, 'objects.read', delegatedReadContext);
    if (!ownCorrection && delegatedCorrection) hasDelegatedObjectAction(user.id, source.relatedObject.id, 'inventory_issue', true, 'inventory.movement.correct', itemContext);
  }
  return allowed;
}

export function canCorrectInventoryMovement(user: AccessSubject, source: InventoryCorrectionSource): boolean {
  // Already-reversed originals remain applied: authorized replay stays available
  // without an audit query per row. Runtime keeps its exact idempotent response.
  return ['issue_to_object', 'issue_to_one_time_order'].includes(source.movementType) &&
    ['applied', 'pending_approval'].includes(source.status) && authorizeInventoryCorrection(user, source);
}
