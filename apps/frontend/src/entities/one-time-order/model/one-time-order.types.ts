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
  plannedPaymentMethod: OneTimeOrderPaymentMethod | null;
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
  workCycle: number;
  completedAt: string | null;
  completedBy: {
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
    canComplete: boolean;
    canReopen: boolean;
    canCorrectPayments: boolean;
    canManageManagers: boolean;
    canManageSpecification: boolean;
    canUploadPhotos: boolean;
    canDeletePhotos: boolean;
    canRestorePhotos: boolean;
    canComment: boolean;
    canAttachFiles: boolean;
    canCreateTask: boolean;
    canEditReview: boolean;
    canCopy: boolean;
    canViewCalendar: boolean;
    canManageOwnAvailability: boolean;
    canManageAnyAvailability: boolean;
    canApproveAvailability: boolean;
  };
}

export type OneTimeOrderPaymentMethod =
  | 'cash'
  | 'personal_card_transfer'
  | 'organization_transfer'
  | 'other';

export type OneTimeOrderPaymentDestination =
  | 'manager_accountability'
  | 'organization';

export type OneTimeOrderPaymentZeroReason =
  | 'payment_later'
  | 'paid_directly_to_organization'
  | 'free_order'
  | 'customer_did_not_pay'
  | 'other';

export interface VisibleOneTimeOrderCompletionPayment {
  id: string;
  detailsRestricted: false;
  completionId: string;
  oneTimeOrderId: string;
  recipient: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  amount: number;
  paymentMethod: OneTimeOrderPaymentMethod;
  paymentDestination: OneTimeOrderPaymentDestination;
  zeroReason: OneTimeOrderPaymentZeroReason | null;
  comment: string | null;
  differenceReason: string | null;
  receivedAt: string;
  recordedBy: {
    id: string;
    login: string;
    fullName: string;
  };
  status: 'active' | 'reversed' | 'reversal';
  reversalOfPaymentId: string | null;
  reversedByPaymentId: string | null;
  correctedFromPaymentId: string | null;
  correctedByPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RestrictedOneTimeOrderCompletionPayment {
  id: string;
  detailsRestricted: true;
}

export type OneTimeOrderCompletionPayment =
  | VisibleOneTimeOrderCompletionPayment
  | RestrictedOneTimeOrderCompletionPayment;

export interface OneTimeOrderCompletion {
  id: string;
  oneTimeOrderId: string;
  workCycle: number;
  completedAt: string | null;
  completedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  completionComment: string | null;
  completionSource: 'native' | 'legacy_unknown';
  status: 'active' | 'superseded';
  clientRequestId: string | null;
  payments: OneTimeOrderCompletionPayment[];
  visibleTotalAmount: number;
  fullTotalAmountVisible: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OneTimeOrderCompletionPaymentPayload {
  recipientUserId?: string | null;
  amount: number;
  paymentMethod: OneTimeOrderPaymentMethod;
  paymentDestination: OneTimeOrderPaymentDestination;
  zeroReason?: OneTimeOrderPaymentZeroReason | null;
  comment?: string | null;
  differenceReason?: string | null;
  receivedAt?: string;
}

export interface CompleteOneTimeOrderPayload {
  workCycle: number;
  completionComment?: string;
  clientRequestId: string;
  payments: OneTimeOrderCompletionPaymentPayload[];
}

export interface CorrectOneTimeOrderPaymentPayload {
  correctedAmount: number;
  paymentMethod: OneTimeOrderPaymentMethod;
  paymentDestination: OneTimeOrderPaymentDestination;
  recipientUserId?: string | null;
  zeroReason?: OneTimeOrderPaymentZeroReason | null;
  comment?: string | null;
  reason: string;
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
  plannedPaymentMethod: OneTimeOrderPaymentMethod;
  financialNotes?: string;
  expenseNotes?: string;
  managerUserIds?: string[];
  conflictFingerprint?: string;
}

export interface CopyOneTimeOrderPayload extends CreateOneTimeOrderPayload {
  specificationItems: Array<{
    title: string;
    description?: string | null;
    requiresAttachment?: boolean;
  }>;
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
  plannedPaymentMethod?: OneTimeOrderPaymentMethod | null;
  financialNotes?: string | null;
  expenseNotes?: string | null;
  conflictFingerprint?: string;
}

export type OneTimeOrderAvailabilityType =
  | 'day_off'
  | 'vacation'
  | 'sick_leave';

export interface OneTimeOrderCalendarAvailability {
  id: string;
  entryType: OneTimeOrderAvailabilityType;
  startDate: string;
  endDate: string;
  status: string;
  comment: string | null;
}

export interface OneTimeOrderCalendarOrder {
  type: 'existing_order';
  detailsRestricted: boolean;
  relatedOrder: {
    id: string;
    title: string;
    status: string;
    executionStartDate: string;
    executionEndDate: string;
    executionAddress: string;
    linkedObject: { id: string; name: string } | null;
    managers: Array<{ id: string; login: string; fullName: string }>;
  } | null;
}

export interface OneTimeOrderCalendarDay {
  date: string;
  availability: OneTimeOrderCalendarAvailability | null;
  pendingRequests: OneTimeOrderCalendarAvailability[];
  orders: OneTimeOrderCalendarOrder[];
  conflictLevel:
    | 'none'
    | 'multiple_orders'
    | 'approved_availability'
    | 'multiple_orders_and_availability';
}

export interface OneTimeOrderCalendarManager {
  user: { id: string; login: string; fullName: string };
  isActive: boolean;
  workedDays: number;
  orderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  days: OneTimeOrderCalendarDay[];
}

export interface OneTimeOrderCalendarResponse {
  month: string;
  daysInMonth: number;
  managers: OneTimeOrderCalendarManager[];
}

export interface OneTimeManagerAvailability {
  id: string;
  userId: string;
  entryType: OneTimeOrderAvailabilityType;
  startDate: string;
  endDate: string;
  durationDays: number;
  status: string;
  requestComment: string | null;
  resolutionComment: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvalRequestId: string | null;
  user: { id: string; login: string; fullName: string };
  requestedBy: { id: string; login: string; fullName: string };
  resolvedBy: { id: string; login: string; fullName: string } | null;
  cancelledBy: { id: string; login: string; fullName: string } | null;
}

export interface OneTimeOrderConflictResponse {
  hasConflicts: boolean;
  conflictFingerprint: string;
  conflicts: Array<{
    date: string;
    user: { id: string; login: string; fullName: string };
    type:
      | 'existing_order'
      | 'day_off'
      | 'vacation'
      | 'sick_leave'
      | 'pending_availability_request';
    relatedOrder: {
      id: string;
      title: string;
      status: string;
      executionStartDate: string;
      executionEndDate: string;
    } | null;
    detailsRestricted: boolean;
  }>;
}
