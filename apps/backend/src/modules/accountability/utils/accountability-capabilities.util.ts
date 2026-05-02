import {
  canApproveAccountabilityClosure,
  canApproveAccountabilityExpense,
  canIssueAccountabilityFunds,
  canReviewAccountability,
  canViewOwnAccountability,
} from './accountability-access.util';

export interface AccountabilityGlobalCapabilities {
  canAccessAccountability: boolean;
  canViewOwnAccountability: boolean;
  canIssueAccountabilityFunds: boolean;
  canReviewAccountability: boolean;
  canApproveAccountabilityClosure: boolean;
}

export function buildAccountabilityGlobalCapabilities(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): AccountabilityGlobalCapabilities {
  const canViewOwn = canViewOwnAccountability();
  const canIssue = canIssueAccountabilityFunds(params);
  const canReview = canReviewAccountability(params);
  const canApproveClosure = canApproveAccountabilityClosure(params);

  return {
    canAccessAccountability: canViewOwn || canReview,
    canViewOwnAccountability: canViewOwn,
    canIssueAccountabilityFunds: canIssue,
    canReviewAccountability: canReview,
    canApproveAccountabilityClosure: canApproveClosure,
  };
}

export function buildAccountabilityExpenseCapabilities(params: {
  isOwnExpense: boolean;
  status: string;
  roleCodes: string[];
  permissionCodes?: string[];
}): {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
} {
  const canReview = canApproveAccountabilityExpense(params);
  const isDraft = params.status === 'draft';
  const isSubmitted = params.status === 'submitted';

  return {
    canEdit: params.isOwnExpense && isDraft,
    canSubmit: params.isOwnExpense && isDraft,
    canApprove: canReview && isSubmitted,
    canReject: canReview && isSubmitted,
  };
}
