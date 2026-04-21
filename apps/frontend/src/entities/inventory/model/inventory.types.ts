import type { AttachedFile } from '@/entities/file/model/file.types';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  notes: string | null;
  currentUnitPrice: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  currentStock: number;
  currentEstimatedTotalValue: number;
  summary: {
    movementsCount: number;
    receiptsCount: number;
    issuesCount: number;
    returnsCount: number;
    writeoffsCount: number;
    adjustmentsCount: number;
  };
  capabilities: {
    canEditCatalog: boolean;
    canCreateMovement: boolean;
    canCreateReceipt: boolean;
    canIssueToObject: boolean;
    canIssueToOneTimeOrder: boolean;
    canReturn: boolean;
    canWriteoff: boolean;
    canAdjust: boolean;
    canViewReports: boolean;
  };
}

export interface InventoryMovement {
  id: string;
  inventoryItem: {
    id: string;
    name: string;
    category: string;
    unit: string;
    isActive: boolean;
  };
  movementType: string;
  quantity: number;
  signedQuantity: number;
  unitPriceSnapshot: number;
  totalAmountSnapshot: number;
  adjustmentDirection: string | null;
  comment: string | null;
  evidenceRequired: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  relatedObject: {
    id: string;
    name: string;
    canOpenObjectCard: boolean;
  } | null;
  relatedOneTimeOrder: {
    id: string;
    title: string;
    status: string;
    canOpenOrderCard: boolean;
  } | null;
  attachments: AttachedFile[];
  projection: {
    hasEvidence: boolean;
    requiresApprovalBridge: boolean;
    approvalBridgeType: string | null;
    approvalBridgeResolvedAt: string | null;
    approvalBridgeResolvedBy: {
      id: string;
      login: string;
      fullName: string;
    } | null;
    isSensitive: boolean;
    canResolveMissingPhotoApproval: boolean;
  };
}

export interface ObjectInventory {
  movements: InventoryMovement[];
  availableItems: InventoryItem[];
  capabilities: {
    canIssueInventoryToObject: boolean;
    canResolveMissingPhotoApproval: boolean;
  };
}

export interface InventoryObjectReference {
  id: string;
  name: string;
  status: string;
}

export interface InventoryOneTimeOrderReference {
  id: string;
  title: string;
  status: string;
}

export interface CreateInventoryItemPayload {
  name: string;
  category: string;
  unit: string;
  isActive?: boolean;
  notes?: string;
}

export interface UpdateInventoryItemPayload {
  name?: string;
  category?: string;
  unit?: string;
  isActive?: boolean;
  notes?: string | null;
}

export interface CreateInventoryMovementPayload {
  inventoryItemId: string;
  movementType:
    | 'receipt'
    | 'issue_to_object'
    | 'issue_to_one_time_order'
    | 'return'
    | 'writeoff'
    | 'adjustment';
  quantity: number;
  unitPrice?: number;
  adjustmentDirection?: 'increase' | 'decrease';
  comment?: string;
  evidenceRequired?: boolean;
  relatedObjectId?: string;
  relatedOneTimeOrderId?: string;
}

export interface ListInventoryItemsParams {
  search?: string;
  category?: string;
  isActive?: boolean;
}

export interface ListInventoryMovementsParams {
  inventoryItemId?: string;
  movementType?: string;
  dateFrom?: string;
  dateTo?: string;
  objectId?: string;
  oneTimeOrderId?: string;
  approvalBridge?: string;
}
