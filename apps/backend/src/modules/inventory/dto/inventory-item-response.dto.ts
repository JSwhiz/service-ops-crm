export class InventoryItemResponseDto {
  id!: string;
  name!: string;
  category!: string;
  unit!: string;
  isActive!: boolean;
  notes!: string | null;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  currentStock!: number;
  summary!: {
    movementsCount: number;
    receiptsCount: number;
    issuesCount: number;
    returnsCount: number;
    writeoffsCount: number;
    adjustmentsCount: number;
  };
  capabilities!: {
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
