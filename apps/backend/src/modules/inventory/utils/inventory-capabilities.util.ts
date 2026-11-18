import {
  canAccessInventory,
  canAdjustInventory,
  canCreateInventoryMovement,
  canCreateInventoryReceipt,
  canIssueInventoryToObject,
  canIssueInventoryToOneTimeOrder,
  canManageInventoryCatalog,
  canDeleteInventoryItem,
  canResolveInventoryMissingPhotoApproval,
  canReturnInventory,
  canViewInventoryReports,
  canWriteoffInventory,
} from './inventory-access.util';
import { AccessContext, AccessSubject, decideAccess } from '../../users-access/utils/access-policy.util';

export interface InventoryGlobalCapabilities {
  canAccessInventory: boolean;
  canManageInventoryCatalog: boolean;
  canDeleteInventoryItem: boolean;
  canRestoreInventoryItem?: boolean;
  canCreateInventoryMovement: boolean;
  canCreateInventoryReceipt: boolean;
  canIssueInventoryToObject: boolean;
  canIssueInventoryToOneTimeOrder: boolean;
  canReturnInventory: boolean;
  canWriteoffInventory: boolean;
  canAdjustInventory: boolean;
  canViewInventoryReports: boolean;
  canViewInventoryMovements: boolean;
  canResolveInventoryMissingPhotoApproval: boolean;
}

export function buildInventoryGlobalCapabilities(
  roleCodes: string[],
  permissionCodes: string[] = [],
  subject?: AccessSubject,
  context: AccessContext = {},
): InventoryGlobalCapabilities {
  const legacy = {
    canAccessInventory: canAccessInventory(roleCodes),
    canManageInventoryCatalog: canManageInventoryCatalog(roleCodes),
    canDeleteInventoryItem: canDeleteInventoryItem(roleCodes, permissionCodes),
    canRestoreInventoryItem: canDeleteInventoryItem(roleCodes, permissionCodes),
    canCreateInventoryMovement: canCreateInventoryMovement(roleCodes),
    canCreateInventoryReceipt: canCreateInventoryReceipt(roleCodes),
    canIssueInventoryToObject: canIssueInventoryToObject(roleCodes),
    canIssueInventoryToOneTimeOrder: canIssueInventoryToOneTimeOrder(roleCodes),
    canReturnInventory: canReturnInventory(roleCodes),
    canWriteoffInventory: canWriteoffInventory(roleCodes),
    canAdjustInventory: canAdjustInventory(roleCodes),
    canViewInventoryReports: canViewInventoryReports(roleCodes),
    canViewInventoryMovements: canAccessInventory(roleCodes),
    canResolveInventoryMissingPhotoApproval:
      canResolveInventoryMissingPhotoApproval(roleCodes),
  };
  if (!subject) return legacy;
  const actions: Record<keyof InventoryGlobalCapabilities, string> = {
    canAccessInventory: 'inventory.access', canManageInventoryCatalog: 'inventory.catalog.update', canDeleteInventoryItem: 'inventory.catalog.delete',
    canRestoreInventoryItem: 'inventory.catalog.restore',
    canCreateInventoryMovement: 'inventory.receipt', canCreateInventoryReceipt: 'inventory.receipt', canIssueInventoryToObject: 'inventory.issue_to_object',
    canIssueInventoryToOneTimeOrder: 'inventory.issue_to_one_time_order', canReturnInventory: 'inventory.return', canWriteoffInventory: 'inventory.writeoff',
    canAdjustInventory: 'inventory.adjustment', canViewInventoryReports: 'inventory.reports',
    canViewInventoryMovements: 'inventory.movements.read', canResolveInventoryMissingPhotoApproval: 'inventory.resolve_missing_photo',
  };
  for (const key of Object.keys(actions) as Array<keyof InventoryGlobalCapabilities>) legacy[key] = decideAccess(subject, actions[key], legacy[key], context);
  // Non-global order issuers use the order-scoped endpoint and its assignment
  // capability; a personal order grant does not authorize the generic endpoint.
  legacy.canIssueInventoryToOneTimeOrder &&= canIssueInventoryToOneTimeOrder(roleCodes);
  // The form is available if any independently authorized movement is available.
  legacy.canCreateInventoryMovement = legacy.canCreateInventoryReceipt ||
    legacy.canIssueInventoryToObject || legacy.canIssueInventoryToOneTimeOrder ||
    legacy.canReturnInventory || legacy.canWriteoffInventory || legacy.canAdjustInventory;
  return legacy;
}
