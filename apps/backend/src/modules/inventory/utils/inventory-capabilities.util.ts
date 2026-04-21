import {
  canAccessInventory,
  canAdjustInventory,
  canCreateInventoryMovement,
  canCreateInventoryReceipt,
  canIssueInventoryToObject,
  canIssueInventoryToOneTimeOrder,
  canManageInventoryCatalog,
  canResolveInventoryMissingPhotoApproval,
  canReturnInventory,
  canViewInventoryReports,
  canWriteoffInventory,
} from './inventory-access.util';

export interface InventoryGlobalCapabilities {
  canAccessInventory: boolean;
  canManageInventoryCatalog: boolean;
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
): InventoryGlobalCapabilities {
  return {
    canAccessInventory: canAccessInventory(roleCodes),
    canManageInventoryCatalog: canManageInventoryCatalog(roleCodes),
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
}
