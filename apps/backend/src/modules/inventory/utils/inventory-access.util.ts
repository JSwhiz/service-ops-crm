import { LEADERSHIP_OBJECT_ROLE_CODES } from '../../objects/utils/object-access.util';

export const INVENTORY_OPERATIONAL_ROLE_CODES = ['deputy_director'] as const;
export const INVENTORY_READONLY_MANAGER_ROLE_CODES = [
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

function canOperateInventory(roleCodes: string[]): boolean {
  return (
    hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES) ||
    hasAnyRole(roleCodes, INVENTORY_OPERATIONAL_ROLE_CODES)
  );
}

export function canAccessInventory(roleCodes: string[]): boolean {
  return (
    canOperateInventory(roleCodes) ||
    hasAnyRole(roleCodes, INVENTORY_READONLY_MANAGER_ROLE_CODES)
  );
}

export function canManageInventoryCatalog(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canCreateInventoryMovement(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canCreateInventoryReceipt(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canIssueInventoryToObject(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canIssueInventoryToOneTimeOrder(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canReturnInventory(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canWriteoffInventory(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canAdjustInventory(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canViewInventoryReports(roleCodes: string[]): boolean {
  return canOperateInventory(roleCodes);
}

export function canResolveInventoryMissingPhotoApproval(
  roleCodes: string[],
): boolean {
  return hasAnyRole(roleCodes, ['director']);
}
