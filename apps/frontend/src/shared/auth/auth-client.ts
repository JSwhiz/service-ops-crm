import { fetcher } from "@/shared/api/fetcher";

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes: string[];
  isActive: boolean;
  accessVersion?: number;
  capabilities?: {
    canAccessObjects?: boolean;
    canAccessMats?: boolean;
    canAccessTasks?: boolean;
    canAccessTimesheet?: boolean;
    canAccessUserAbsences?: boolean;
    canAccessVisitPlans?: boolean;
    canAccessUserSubstitutions?: boolean;
    canAccessDashboard?: boolean;
    canUploadFile?: boolean;
    canViewLeadershipDashboard?: boolean;
    canViewManagerDashboard?: boolean;
    canViewHrDashboard?: boolean;
    canViewOperationsDashboard?: boolean;
    canReadSpecificationCatalog?: boolean;
    canCreateSpecificationCatalog?: boolean;
    canUpdateSpecificationCatalog?: boolean;
    canArchiveSpecificationCatalog?: boolean;
    canManageUserAccess?: boolean;
    canCreateTask?: boolean;
    canCreateCandidate?: boolean;
    canCreateCounterparty?: boolean;
    canCreateInventoryItem?: boolean;
    canCreateEquipmentUnit?: boolean;
    canAccessSearch?: boolean;
    canAccessNotifications?: boolean;
    canAccessCounterparties?: boolean;
    canManageCounterparties?: boolean;
    canLinkCounterpartyObjects?: boolean;
    canAccessCandidates?: boolean;
    canManageCandidates?: boolean;
    canRespondToCandidates?: boolean;
    canAccessApprovals?: boolean;
    canResolveTaskResultApproval?: boolean;
    canResolveInventoryApproval?: boolean;
    canResolveObjectChangeApproval?: boolean;
    canResolveAccountabilityApproval?: boolean;
    canResolveTimesheetApproval?: boolean;
    canCreateObject: boolean;
    canCreateObjectBudget?: boolean;
    canAccessOneTimeOrders?: boolean;
    canCreateOneTimeOrder?: boolean;
    canViewAllOneTimeOrderReviews?: boolean;
    canViewOneTimeOrderCalendar?: boolean;
    canManageOwnOneTimeOrderAvailability?: boolean;
    canManageAnyOneTimeOrderAvailability?: boolean;
    canApproveOneTimeOrderAvailability?: boolean;
    canAccessEmployeesHr?: boolean;
    canReadWorkforceSubstitutions?: boolean;
    canManageEmployeesHr?: boolean;
    canCreateEmployee?: boolean;
    canEditEmployee?: boolean;
    canArchiveEmployee?: boolean;
    canRestoreEmployee?: boolean;
    canDeleteEmployeePermanently?: boolean;
    canManageEmployeeAssignments?: boolean;
    canDeleteEmployeeAssignmentAsError?: boolean;
    canAccessAccountability?: boolean;
    canViewOwnAccountability?: boolean;
    canRecordExternalReceipt?: boolean;
    canIssueAccountabilityFunds?: boolean;
    canReviewAccountability?: boolean;
    canDiscoverAccountabilityReview?: boolean;
    canApproveAccountabilityClosure?: boolean;
    canAccessInventory?: boolean;
    canManageInventoryCatalog?: boolean;
    canDeleteInventoryItem?: boolean;
    canCreateInventoryMovement?: boolean;
    canCreateInventoryReceipt?: boolean;
    canIssueInventoryToObject?: boolean;
    canIssueInventoryToOneTimeOrder?: boolean;
    canReturnInventory?: boolean;
    canWriteoffInventory?: boolean;
    canAdjustInventory?: boolean;
    canViewInventoryReports?: boolean;
    canViewInventoryMovements?: boolean;
    canResolveInventoryMissingPhotoApproval?: boolean;
    canAccessEquipment?: boolean;
    canReadEquipmentCatalog?: boolean;
    canDeleteEquipmentCatalog?: boolean;
    canManageEquipmentCatalog?: boolean;
    canDeleteEquipmentUnit?: boolean;
    canAssignEquipmentToObject?: boolean;
    canAssignEquipmentToOneTimeOrder?: boolean;
    canReturnEquipment?: boolean;
    canMoveEquipment?: boolean;
    canMarkEquipmentBroken?: boolean;
    canSendEquipmentToRepair?: boolean;
    canReturnEquipmentFromRepair?: boolean;
    canWriteoffEquipment?: boolean;
    canViewEquipmentHistory?: boolean;
    canAccessChats?: boolean;
    canManageChats?: boolean;
    canCreateDirectChat?: boolean;
    canCreateGroupChat?: boolean;
  };
}

export interface LoginPayload {
  login: string;
  password: string;
}

export interface AuthResponse {
  user: AuthUser;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  return fetcher<AuthResponse>("/auth/login", {
    method: "POST",
    skipAuthRetry: true,
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify(payload),
  });
}

export async function refreshSessionRequest(): Promise<AuthResponse> {
  return fetcher<AuthResponse>("/auth/refresh", {
    method: "POST",
    skipAuthRetry: true,
    signal: AbortSignal.timeout(30_000),
  });
}

export async function getMe({ confirmLogin = false } = {}): Promise<AuthUser> {
  return fetcher<AuthUser>(confirmLogin ? "/auth/me?confirmLogin=1" : "/auth/me", {
    method: "GET",
    ...(confirmLogin ? { skipAuthRetry: true } : {}),
    signal: AbortSignal.timeout(30_000),
  });
}

export async function logout(): Promise<{ success: true }> {
  return fetcher<{ success: true }>("/auth/logout", {
    method: "POST",
    skipAuthRetry: true,
    signal: AbortSignal.timeout(30_000),
  });
}
