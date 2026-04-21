export class MeResponseDto {
  id!: string;
  login!: string;
  fullName!: string;
  roleCode!: string;
  roleCodes!: string[];
  isActive!: boolean;
  capabilities!: {
    canCreateObject: boolean;
    canAccessOneTimeOrders: boolean;
    canCreateOneTimeOrder: boolean;
    canAccessEmployeesHr: boolean;
    canManageEmployeesHr: boolean;
    canAccessInventory: boolean;
    canManageInventoryCatalog: boolean;
    canCreateInventoryMovement: boolean;
    canCreateInventoryReceipt: boolean;
    canIssueInventoryToObject: boolean;
    canIssueInventoryToOneTimeOrder: boolean;
    canReturnInventory: boolean;
    canWriteoffInventory: boolean;
    canAdjustInventory: boolean;
    canViewInventoryReports: boolean;
    canResolveInventoryMissingPhotoApproval: boolean;
  };
}
