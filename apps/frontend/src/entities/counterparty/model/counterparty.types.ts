export interface CounterpartyListItem {
  id: string;
  name: string;
  legalName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: 'active' | 'archived';
  objectCount: number;
  updatedAt: string;
}

export interface CounterpartyObjectSummary {
  id: string;
  name: string;
  internalName: string | null;
  address: string;
  status: string;
}

export interface CounterpartyInventoryMovement {
  id: string;
  inventoryItem: { id: string; name: string; category: string; unit: string; isActive: boolean };
  movementType: string;
  status: string;
  quantity: number;
  signedQuantity: number;
  comment: string | null;
  createdAt: string;
  createdBy: { id: string; login: string; fullName: string };
  relatedObject: { id: string; name: string; canOpenObjectCard: boolean } | null;
}

export interface CounterpartyInventoryMovementList {
  items: CounterpartyInventoryMovement[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CounterpartyCard extends CounterpartyListItem {
  notes: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  visibleObjectCount: number;
  masterObject: CounterpartyObjectSummary | null;
  objects: CounterpartyObjectSummary[];
  capabilities: {
    canManage: boolean;
    canLinkObjects: boolean;
  };
}

export interface CounterpartyListResponse {
  items: CounterpartyListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CounterpartyReference {
  id: string;
  name: string;
  legalName: string | null;
  status: 'active' | 'archived';
}

export interface CounterpartyHistoryItem {
  id: string;
  action: string;
  createdAt: string;
  actor: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}
