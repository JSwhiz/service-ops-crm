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
  canCreateInventoryMovement: boolean;
  canCreateInventoryReceipt: boolean;
  canIssueInventoryToObject: boolean;
  canIssueInventoryToOneTimeOrder: boolean;
  canReturnInventory: boolean;
  canWriteoffInventory: boolean;
  canAdjustInventory: boolean;
  canViewInventoryReports: boolean;
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
    canCreateInventoryMovement: canCreateInventoryMovement(roleCodes),
    canCreateInventoryReceipt: canCreateInventoryReceipt(roleCodes),
    canIssueInventoryToObject: canIssueInventoryToObject(roleCodes),
    canIssueInventoryToOneTimeOrder: canIssueInventoryToOneTimeOrder(roleCodes),
    canReturnInventory: canReturnInventory(roleCodes),
    canWriteoffInventory: canWriteoffInventory(roleCodes),
    canAdjustInventory: canAdjustInventory(roleCodes),
    canViewInventoryReports: canViewInventoryReports(roleCodes),
    canResolveInventoryMissingPhotoApproval:
      canResolveInventoryMissingPhotoApproval(roleCodes),
  };
  if (!subject) return legacy;
  const actions: Record<keyof InventoryGlobalCapabilities, string> = {
    canAccessInventory: 'inventory.access', canManageInventoryCatalog: 'inventory.catalog.update', canDeleteInventoryItem: 'inventory.catalog.delete',
    canCreateInventoryMovement: 'inventory.receipt', canCreateInventoryReceipt: 'inventory.receipt', canIssueInventoryToObject: 'inventory.issue_to_object',
    canIssueInventoryToOneTimeOrder: 'inventory.issue_to_one_time_order', canReturnInventory: 'inventory.return', canWriteoffInventory: 'inventory.writeoff',
    canAdjustInventory: 'inventory.adjustment', canViewInventoryReports: 'inventory.reports', canResolveInventoryMissingPhotoApproval: 'inventory.resolve_missing_photo',
  };
  for (const key of Object.keys(actions) as Array<keyof InventoryGlobalCapabilities>) legacy[key] = decideAccess(subject, actions[key], legacy[key], context);
  return legacy;
}
