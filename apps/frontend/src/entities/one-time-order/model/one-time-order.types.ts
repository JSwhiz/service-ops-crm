import type { AttachedFile } from '@/entities/file/model/file.types';

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
  executionStartDate: string | null;
  executionEndDate: string | null;
  durationDays: number | null;
  contactName: string;
  contactPhone: string | null;
  agreedSum: number | null;
  financialNotes: string | null;
  expenseNotes: string | null;
  reviewText: string | null;
  reviewRating: number | null;
  reviewUpdatedAt: string | null;
  reviewUpdatedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
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
    canEditOperationalFields: boolean;
    canEditFinancialFields: boolean;
    canChangeLinkedObject: boolean;
    canChangeStatus: boolean;
    canManageManagers: boolean;
    canManageSpecification: boolean;
    canUploadPhotos: boolean;
    canDeletePhotos: boolean;
    canRestorePhotos: boolean;
    canComment: boolean;
    canAttachFiles: boolean;
    canCreateTask: boolean;
    canEditReview: boolean;
    canViewCalendar: boolean;
    canManageOwnAvailability: boolean;
    canManageAnyAvailability: boolean;
    canApproveAvailability: boolean;
  };
}

export interface OneTimeOrderListItem {
  id: string;
  title: string;
  executionStartDate: string | null;
  executionEndDate: string | null;
  durationDays: number | null;
  status: string;
  executionAddress: string;
  linkedObject: {
    id: string;
    name: string;
    canOpenObjectCard: boolean;
  } | null;
  managers: Array<{
    userId: string;
    login: string;
    fullName: string;
    roleCode: string;
  }>;
  contact: {
    name: string;
    phone: string | null;
  };
  reviewRating: number | null;
  reviewPreview: string | null;
  specificationProgress: {
    completed: number;
    total: number;
  };
  accessibleTaskCount: number;
  capabilities: OneTimeOrderItem['capabilities'];
  createdAt: string;
  updatedAt: string;
}

export interface OneTimeOrderListResponse {
  items: OneTimeOrderListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
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
  attachments: AttachedFile[];
}

export interface OneTimeOrderDailyReportItem {
  id: string;
  oneTimeOrderId: string;
  reportDate: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments: AttachedFile[];
}

export interface OneTimeOrderPhotoItem {
  id: string;
  oneTimeOrderId: string;
  category: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  deletedAt: string | null;
  deletedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  deleteReason: string | null;
  restoredAt: string | null;
  restoredBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  capabilities: {
    canDelete: boolean;
    canRestore: boolean;
  };
  attachments: AttachedFile[];
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

export interface OneTimeOrderSpecificationItem {
  id: string;
  oneTimeOrderId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  requiresAttachment: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  completedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  createdAt: string;
  updatedAt: string;
  attachments: AttachedFile[];
}

export interface CreateOneTimeOrderPayload {
  title: string;
  executionAddress: string;
  linkedObjectId?: string | null;
  status?: string;
  description?: string;
  executionDate?: string;
  executionStartDate?: string | null;
  executionEndDate?: string | null;
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
  executionStartDate?: string | null;
  executionEndDate?: string | null;
  contactName?: string;
  contactPhone?: string | null;
  agreedSum?: number | null;
  financialNotes?: string | null;
  expenseNotes?: string | null;
}
