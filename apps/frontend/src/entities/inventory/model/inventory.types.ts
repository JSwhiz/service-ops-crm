import type { AttachedFile } from '@/entities/file/model/file.types';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  currentStock: number;
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
    isSensitive: boolean;
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
}
