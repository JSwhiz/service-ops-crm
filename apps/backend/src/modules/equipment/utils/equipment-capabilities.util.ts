import {
  canAccessEquipment,
  canAssignEquipmentToObject,
  canAssignEquipmentToOneTimeOrder,
  canManageEquipmentCatalog,
  canMarkEquipmentBroken,
  canMoveEquipment,
  canReturnEquipment,
  canReturnEquipmentFromRepair,
  canSendEquipmentToRepair,
  canViewEquipmentHistory,
  canWriteoffEquipment,
} from './equipment-access.util';

export interface EquipmentGlobalCapabilities {
  canAccessEquipment: boolean;
  canManageEquipmentCatalog: boolean;
  canAssignEquipmentToObject: boolean;
  canAssignEquipmentToOneTimeOrder: boolean;
  canReturnEquipment: boolean;
  canMoveEquipment: boolean;
  canMarkEquipmentBroken: boolean;
  canSendEquipmentToRepair: boolean;
  canReturnEquipmentFromRepair: boolean;
  canWriteoffEquipment: boolean;
  canViewEquipmentHistory: boolean;
}

export function buildEquipmentGlobalCapabilities(
  roleCodes: string[],
): EquipmentGlobalCapabilities {
  return {
    canAccessEquipment: canAccessEquipment(roleCodes),
    canManageEquipmentCatalog: canManageEquipmentCatalog(roleCodes),
    canAssignEquipmentToObject: canAssignEquipmentToObject(roleCodes),
    canAssignEquipmentToOneTimeOrder:
      canAssignEquipmentToOneTimeOrder(roleCodes),
    canReturnEquipment: canReturnEquipment(roleCodes),
    canMoveEquipment: canMoveEquipment(roleCodes),
    canMarkEquipmentBroken: canMarkEquipmentBroken(roleCodes),
    canSendEquipmentToRepair: canSendEquipmentToRepair(roleCodes),
    canReturnEquipmentFromRepair: canReturnEquipmentFromRepair(roleCodes),
    canWriteoffEquipment: canWriteoffEquipment(roleCodes),
    canViewEquipmentHistory: canViewEquipmentHistory(roleCodes),
  };
}
