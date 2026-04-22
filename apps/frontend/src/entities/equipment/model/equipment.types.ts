import type { AttachedFile } from '@/entities/file/model/file.types';

export interface EquipmentCatalogItem {
  id: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentUnit {
  id: string;
  inventoryNumber: string;
  serialNumber: string | null;
  status: string;
  notes: string | null;
  currentObject: { id: string; name: string; canOpenObjectCard: boolean } | null;
  currentOneTimeOrder: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  catalogItem: EquipmentCatalogItem;
  createdAt: string;
  updatedAt: string;
  capabilities: {
    canCreateMovement: boolean;
    canAssignToObject: boolean;
    canAssignToOneTimeOrder: boolean;
    canReturn: boolean;
    canMove: boolean;
    canMarkBroken: boolean;
    canSendToRepair: boolean;
    canReturnFromRepair: boolean;
    canWriteoff: boolean;
    canViewHistory: boolean;
  };
}

export interface EquipmentMovement {
  id: string;
  equipmentUnitId: string;
  movementType: string;
  fromStatus: string | null;
  toStatus: string;
  fromObject: { id: string; name: string; canOpenObjectCard: boolean } | null;
  toObject: { id: string; name: string; canOpenObjectCard: boolean } | null;
  fromOneTimeOrder: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  toOneTimeOrder: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  comment: string | null;
  createdBy: { id: string; login: string; fullName: string };
  createdAt: string;
  attachments: AttachedFile[];
}

export interface EquipmentScope {
  units: EquipmentUnit[];
  capabilities: {
    canViewEquipmentHistory: boolean;
  };
}

export interface CreateEquipmentCatalogItemPayload {
  category: string;
  name: string;
  brand?: string;
  model?: string;
  isActive?: boolean;
  notes?: string;
}

export interface CreateEquipmentUnitPayload {
  catalogItemId: string;
  inventoryNumber: string;
  serialNumber?: string;
  notes?: string;
}

export interface CreateEquipmentMovementPayload {
  movementType: string;
  toObjectId?: string;
  toOneTimeOrderId?: string;
  comment?: string;
}

export interface CreateEquipmentMovementFormPayload {
  payload: CreateEquipmentMovementPayload;
  evidenceFiles: File[];
}

export interface ListEquipmentUnitsParams {
  search?: string;
  status?: string;
  objectId?: string;
  oneTimeOrderId?: string;
}
