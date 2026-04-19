export class OneTimeOrderResponseDto {
  id!: string;
  title!: string;
  executionAddress!: string;
  status!: string;
  description!: string | null;
  executionDate!: string | null;
  contactName!: string;
  contactPhone!: string | null;
  agreedSum!: number | null;
  financialNotes!: string | null;
  expenseNotes!: string | null;
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
    canChangeLinkedObject: boolean;
    canChangeStatus: boolean;
    canManageManagers: boolean;
    canComment: boolean;
    canAttachFiles: boolean;
    canCreateTask: boolean;
  };
}
