export class InventoryItemResponseDto {
  id!: string;
  name!: string;
  category!: string;
  unit!: string;
  isActive!: boolean;
  deletedAt!: string | null;
  notes!: string | null;
  currentUnitPrice!: number | null;
  version!: number;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  currentStock!: number;
  currentEstimatedTotalValue!: number;
  summary!: {
    movementsCount: number;
    receiptsCount: number;
    issuesCount: number;
    returnsCount: number;
    writeoffsCount: number;
    adjustmentsCount: number;
  };
  archiveState!: {
    canArchive: boolean;
    pendingMovementsCount: number;
    pendingApprovalsCount: number;
    blockerCodes: string[];
  };
  deletionState!: {
    canDelete: boolean;
    mode: 'hard' | 'soft';
    pendingMovementsCount: number;
    pendingApprovalsCount: number;
    blockerCodes: string[];
  };
  capabilities!: {
    canEditCatalog: boolean;
    canDelete: boolean;
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
