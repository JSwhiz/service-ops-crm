export class OneTimeOrderResponseDto {
  id!: string;
  title!: string;
  executionAddress!: string;
  status!: string;
  description!: string | null;
  executionDate!: string | null;
  executionStartDate!: string | null;
  executionEndDate!: string | null;
  durationDays!: number | null;
  contactName!: string;
  contactPhone!: string | null;
  agreedSum!: number | null;
  plannedPaymentMethod!: string | null;
  financialNotes!: string | null;
  expenseNotes!: string | null;
  reviewText!: string | null;
  reviewRating!: number | null;
  reviewUpdatedAt!: string | null;
  reviewUpdatedBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  workCycle!: number;
  completedAt!: string | null;
  completedBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  linkedObject!: {
    id: string;
    name: string;
    canOpenObjectCard: boolean;
  } | null;
  managers!: Array<{
    userId: string;
    fullName: string;
    roleCode: string;
  }>;
  capabilities!: {
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
