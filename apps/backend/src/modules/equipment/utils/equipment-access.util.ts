import { LEADERSHIP_OBJECT_ROLE_CODES } from '../../objects/utils/object-access.util';

export const EQUIPMENT_OPERATIONAL_ROLE_CODES = ['deputy_director'] as const;
export const EQUIPMENT_READONLY_MANAGER_ROLE_CODES = [
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

function hasAnyRole(roleCodes: string[], allowed: readonly string[]): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

function canOperateEquipment(roleCodes: string[]): boolean {
  return (
    hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES) ||
    hasAnyRole(roleCodes, EQUIPMENT_OPERATIONAL_ROLE_CODES)
  );
}

export function canAccessEquipment(roleCodes: string[]): boolean {
  return (
    canOperateEquipment(roleCodes) ||
    hasAnyRole(roleCodes, EQUIPMENT_READONLY_MANAGER_ROLE_CODES)
  );
}

export function canManageEquipmentCatalog(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canAssignEquipmentToObject(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canAssignEquipmentToOneTimeOrder(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canReturnEquipment(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canMoveEquipment(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canMarkEquipmentBroken(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canSendEquipmentToRepair(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canReturnEquipmentFromRepair(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canWriteoffEquipment(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}

export function canViewEquipmentHistory(roleCodes: string[]): boolean {
  return canOperateEquipment(roleCodes);
}
