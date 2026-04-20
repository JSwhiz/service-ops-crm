import { FileResponseDto } from '../../files/dto/file-response.dto';

export class InventoryMovementResponseDto {
  id!: string;
  inventoryItem!: {
    id: string;
    name: string;
    category: string;
    unit: string;
    isActive: boolean;
  };
  movementType!: string;
  quantity!: number;
  signedQuantity!: number;
  adjustmentDirection!: string | null;
  comment!: string | null;
  evidenceRequired!: boolean;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  relatedObject!: {
    id: string;
    name: string;
    canOpenObjectCard: boolean;
  } | null;
  relatedOneTimeOrder!: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  attachments!: FileResponseDto[];
  projection!: {
    hasEvidence: boolean;
    requiresApprovalBridge: boolean;
    approvalBridgeType: string | null;
    isSensitive: boolean;
  };
}
