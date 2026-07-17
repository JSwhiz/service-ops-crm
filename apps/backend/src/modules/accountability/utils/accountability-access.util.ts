import { LEADERSHIP_OBJECT_ROLE_CODES } from '../../objects/utils/object-access.util';

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

const ACCOUNTABILITY_DEFAULT_ISSUER_ROLES = ['founder', 'director'] as const;
const ACCOUNTABILITY_DEFAULT_REVIEWER_ROLES = ['founder', 'director'] as const;
const ACCOUNTABILITY_OWN_MANAGER_ROLES = [
  'manager',
  'senior_manager',
  'operation_manager',
] as const;
const ACCOUNTABILITY_ISSUE_PERMISSION = 'accountability.issue_cash';
const EXPENSE_APPROVE_PERMISSION = 'expense.approve';

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
  if (hasAnyRole(params.roleCodes, ACCOUNTABILITY_DEFAULT_ISSUER_ROLES)) {
    return true;
  }

  return (
    hasAnyRole(params.roleCodes, LEADERSHIP_OBJECT_ROLE_CODES) &&
    hasPermission(params.permissionCodes, ACCOUNTABILITY_ISSUE_PERMISSION)
  );
}

export function canApproveAccountabilityExpense(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return (
    hasAnyRole(params.roleCodes, ACCOUNTABILITY_DEFAULT_REVIEWER_ROLES) ||
    hasPermission(params.permissionCodes, EXPENSE_APPROVE_PERMISSION)
  );
}

export function canReviewAccountability(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return (
    canIssueAccountabilityFunds(params) ||
    canApproveAccountabilityExpense(params)
  );
}

export function canApproveAccountabilityClosure(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  return canApproveAccountabilityExpense(params);
}
