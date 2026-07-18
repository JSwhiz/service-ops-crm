export const ACCOUNTABILITY_ACCOUNT_STATUSES = [
  'active',
  'closing_requested',
  'closed',
] as const;

export const ACCOUNTABILITY_EXPENSE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reconciled',
] as const;

export const ACCOUNTABILITY_EXPENSE_CATEGORIES = [
  'consumables',
  'delivery',
  'transport',
  'services',
  'other',
] as const;

export const ACCOUNTABILITY_CLOSURE_STATUSES = [
  'requested',
  'approved',
  'rejected',
] as const;

const ACCOUNTABILITY_OWN_MANAGER_ROLES = [
  'manager',
  'senior_manager',
  'operation_manager',
] as const;
export const ACCOUNTABILITY_ISSUE_PERMISSION = 'accountability.issue_cash';
export const ACCOUNTABILITY_REVIEW_PERMISSION = 'accountability.review';
export const EXPENSE_APPROVE_PERMISSION = 'expense.approve';
export const ACCOUNTABILITY_CLOSURE_APPROVE_PERMISSION =
  'accountability.closure.approve';
export const ACCOUNTABILITY_CORRECT_RECEIPT_PERMISSION =
  'accountability.correct_receipt';

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

function hasPermission(
  permissionCodes: string[] | undefined,
  code: string,
): boolean {
  return (permissionCodes ?? []).includes(code);
}

export function canViewOwnAccountability(params: {
  roleCodes: string[];
  hasActiveOneTimeManagerAssignment?: boolean;
  hasHistoricalOneTimeOrderReceipt?: boolean;
}): boolean {
  return (
    hasAnyRole(params.roleCodes, ACCOUNTABILITY_OWN_MANAGER_ROLES) ||
    params.hasActiveOneTimeManagerAssignment === true ||
    params.hasHistoricalOneTimeOrderReceipt === true
  );
}

export function canIssueAccountabilityFunds(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return hasPermission(params.permissionCodes, ACCOUNTABILITY_ISSUE_PERMISSION);
}

export function canApproveAccountabilityExpense(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return hasPermission(params.permissionCodes, EXPENSE_APPROVE_PERMISSION);
}

export function canReviewAccountability(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return hasPermission(params.permissionCodes, ACCOUNTABILITY_REVIEW_PERMISSION);
}

export function canApproveAccountabilityClosure(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return hasPermission(
    params.permissionCodes,
    ACCOUNTABILITY_CLOSURE_APPROVE_PERMISSION,
  );
}

export function canCorrectAccountabilityReceipt(params: {
  permissionCodes?: string[];
}): boolean {
  return hasPermission(
    params.permissionCodes,
    ACCOUNTABILITY_CORRECT_RECEIPT_PERMISSION,
  );
}
