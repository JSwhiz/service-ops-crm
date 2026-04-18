export interface OneTimeOrderManager {
  userId: string;
  fullName: string;
  roleCode: string;
}

export interface OneTimeOrderItem {
  id: string;
  title: string;
  executionAddress: string;
  status: string;
  description: string | null;
  executionDate: string | null;
  contactName: string;
  contactPhone: string | null;
  agreedSum: number | null;
  financialNotes: string | null;
  expenseNotes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  linkedObject: {
    id: string;
    name: string;
    canOpenObjectCard: boolean;
  } | null;
  managers: OneTimeOrderManager[];
  capabilities: {
    canEdit: boolean;
    canChangeStatus: boolean;
    canManageManagers: boolean;
    canComment: boolean;
    canAttachFiles: boolean;
    canCreateTask: boolean;
  };
}

export interface OneTimeOrderCommentItem {
  id: string;
  oneTimeOrderId: string;
  content: string;
  commentType: string;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
}

export interface OneTimeOrderHistoryItem {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  createdAt: string;
  actor: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateOneTimeOrderPayload {
  title: string;
  executionAddress: string;
  linkedObjectId?: string | null;
  status?: string;
  description?: string;
  executionDate?: string;
  contactName: string;
  contactPhone?: string;
  agreedSum?: number;
  financialNotes?: string;
  expenseNotes?: string;
  managerUserIds?: string[];
}

export interface UpdateOneTimeOrderPayload {
  title?: string;
  executionAddress?: string;
  linkedObjectId?: string | null;
  description?: string | null;
  executionDate?: string | null;
  contactName?: string;
  contactPhone?: string | null;
  agreedSum?: number | null;
  financialNotes?: string | null;
  expenseNotes?: string | null;
}
