import { FileResponseDto } from '../../files/dto/file-response.dto';

export class EquipmentCatalogItemResponseDto {
  id!: string;
  category!: string;
  name!: string;
  brand!: string | null;
  model!: string | null;
  isActive!: boolean;
  notes!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class EquipmentMovementResponseDto {
  id!: string;
  equipmentUnitId!: string;
  movementType!: string;
  status!: string;
  fromStatus!: string | null;
  toStatus!: string;
  fromObject!: { id: string; name: string; canOpenObjectCard: boolean } | null;
  toObject!: { id: string; name: string; canOpenObjectCard: boolean } | null;
  fromOneTimeOrder!: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  toOneTimeOrder!: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  comment!: string | null;
  createdBy!: { id: string; login: string; fullName: string };
  createdAt!: string;
  attachments!: FileResponseDto[];
  approvalRequest!: {
    id: string;
    approvalType: string;
    status: string;
  } | null;
}

export class EquipmentUnitResponseDto {
  id!: string;
  inventoryNumber!: string;
  serialNumber!: string | null;
  status!: string;
  notes!: string | null;
  currentObject!: { id: string; name: string; canOpenObjectCard: boolean } | null;
  currentOneTimeOrder!: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  catalogItem!: EquipmentCatalogItemResponseDto;
  createdAt!: string;
  updatedAt!: string;
  capabilities!: {
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

export class EquipmentScopeResponseDto {
  units!: EquipmentUnitResponseDto[];
  capabilities!: {
    canViewEquipmentHistory: boolean;
  };
}
