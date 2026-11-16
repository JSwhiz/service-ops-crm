import {
  canApproveAccountabilityClosure,
  canApproveAccountabilityExpense,
  canIssueAccountabilityFunds,
  canReviewAccountability,
  canViewOwnAccountability,
} from './accountability-access.util';
import { type AccessContext, type AccessSubject, decideAccess } from '../../users-access/utils/access-policy.util';

export interface AccountabilityGlobalCapabilities {
  canAccessAccountability: boolean;
  canViewOwnAccountability: boolean;
  canIssueAccountabilityFunds: boolean;
  canReviewAccountability: boolean;
  canApproveAccountabilityClosure: boolean;
  canRecordExternalReceipt: boolean;
}

export function buildAccountabilityGlobalCapabilities(params: {
  roleCodes: string[];
  permissionCodes?: string[];
  hasActiveOneTimeManagerAssignment?: boolean;
  hasHistoricalOneTimeOrderReceipt?: boolean;
  isActiveUser?: boolean;
}): AccountabilityGlobalCapabilities {
  const canViewOwn = canViewOwnAccountability(params);
  const canIssue = canIssueAccountabilityFunds(params);
  const canReview = canReviewAccountability(params);
  const canApproveClosure = canApproveAccountabilityClosure(params);
  const canRecordExternalReceipt = params.isActiveUser === true;

  return {
    canAccessAccountability:
      canViewOwn || canIssue || canReview || canApproveClosure || canRecordExternalReceipt,
    canViewOwnAccountability: canViewOwn,
    canIssueAccountabilityFunds: canIssue,
    canReviewAccountability: canReview,
    canApproveAccountabilityClosure: canApproveClosure,
    canRecordExternalReceipt,
  };
}

export function buildAccountabilityExpenseCapabilities(params: {
  subject?: AccessSubject;
  ownerUserId?: string;
  isOwnExpense: boolean;
  legacyOwnExpenseAllowed: boolean;
  accountStatus: string;
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
  const ownDraft = params.isOwnExpense && isDraft && params.accountStatus === 'active';
  const ownContext: AccessContext = {
    resourceType: 'user',
    resourceId: params.ownerUserId,
    ownerUserId: params.ownerUserId,
    parents: [{ actionCode: 'accountability.read' }],
  };

  return {
    canEdit: ownDraft && (params.subject
      ? decideAccess(params.subject, 'accountability.expenses.update', params.legacyOwnExpenseAllowed, ownContext)
      : params.legacyOwnExpenseAllowed),
    canSubmit: ownDraft && (params.subject
      ? decideAccess(params.subject, 'accountability.expenses.submit', params.legacyOwnExpenseAllowed, ownContext)
      : params.legacyOwnExpenseAllowed),
    canApprove: canReview && isSubmitted && !params.isOwnExpense && (!params.subject || decideAccess(params.subject, 'accountability.expenses.approve', true, { resourceType: 'user', resourceId: params.ownerUserId, ownerUserId: params.ownerUserId })),
    canReject: canReview && isSubmitted && (!params.subject || decideAccess(params.subject, 'accountability.expenses.reject', true, { resourceType: 'user', resourceId: params.ownerUserId, ownerUserId: params.ownerUserId })),
  };
}
