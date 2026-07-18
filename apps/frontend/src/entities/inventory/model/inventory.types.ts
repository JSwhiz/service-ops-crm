import type { AttachedFile } from '@/entities/file/model/file.types';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  notes: string | null;
  currentUnitPrice: number | null;
  version: number;
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
  archiveState: {
    canArchive: boolean;
    pendingMovementsCount: number;
    pendingApprovalsCount: number;
    blockerCodes: string[];
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

export interface InventoryItemListResponse {
  items: InventoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InventoryMovementListResponse {
  items: InventoryMovement[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InventoryReportSummary {
  totalItems: number;
  totalActiveItems: number;
  movementCount: number;
  totalStockValueEstimate: number;
  missingPhotoBridgeCount: number;
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
  status: string;
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
  approvalRequest: {
    id: string;
    approvalType: string;
    status: string;
  } | null;
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
  expectedVersion: number;
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
  page?: number;
  limit?: number;
  sortBy?:
    | 'name'
    | 'category'
    | 'unit'
    | 'currentUnitPrice'
    | 'createdAt'
    | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
}

export interface ListInventoryMovementsParams {
  inventoryItemId?: string;
  movementType?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  objectId?: string;
  oneTimeOrderId?: string;
  approvalBridge?: string;
  page?: number;
  limit?: number;
}
