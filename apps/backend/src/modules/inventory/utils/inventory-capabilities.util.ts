import {
  canAccessInventory,
  canAdjustInventory,
  canCreateInventoryMovement,
  canCreateInventoryReceipt,
  canIssueInventoryToObject,
  canIssueInventoryToOneTimeOrder,
  canManageInventoryCatalog,
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
  canWriteoffInventory: boolean;
  canAdjustInventory: boolean;
  canViewInventoryReports: boolean;
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
    canWriteoffInventory: canWriteoffInventory(roleCodes),
    canAdjustInventory: canAdjustInventory(roleCodes),
    canViewInventoryReports: canViewInventoryReports(roleCodes),
  };
}
