import type { AttachedFile } from '@/entities/file/model/file.types';

export interface AccountabilityUserSummary {
  id: string;
  login: string;
  fullName: string;
  roleCodes: string[];
}

export interface AccountabilityFundingEntry {
  id: string;
  amount: number;
  comment: string | null;
  issuedAt: string;
  issuedBy: AccountabilityUserSummary;
}

export interface AccountabilityExpenseItem {
  id: string;
  amount: number;
  description: string;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionComment: string | null;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: AccountabilityUserSummary;
  approvedBy: AccountabilityUserSummary | null;
  rejectedBy: AccountabilityUserSummary | null;
  attachments: AttachedFile[];
  capabilities: {
    canEdit: boolean;
    canSubmit: boolean;
    canApprove: boolean;
    canReject: boolean;
  };
}

export interface AccountabilityClosureItem {
  id: string;
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  comment: string | null;
  requestedBy: AccountabilityUserSummary;
  approvedBy: AccountabilityUserSummary | null;
  rejectedBy: AccountabilityUserSummary | null;
  capabilities: {
    canApprove: boolean;
    canReject: boolean;
  };
}

export interface AccountabilitySummary {
  totalFunding: number;
  totalRecordedExpenses: number;
  totalApprovedExpenses: number;
  totalRejectedExpenses: number;
  totalReconciledExpenses: number;
  currentBalance: number;
  submittedExpensesCount: number;
  draftExpensesCount: number;
}

export interface AccountabilityAccountView {
  account: {
    id: string | null;
    user: AccountabilityUserSummary;
    status: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  summary: AccountabilitySummary;
  capabilities: {
    canCreateExpense: boolean;
    canRequestClosure: boolean;
    canIssueFunding: boolean;
    canReviewExpenses: boolean;
    canApproveAccountabilityClosure: boolean;
  };
  fundings: AccountabilityFundingEntry[];
  expenses: AccountabilityExpenseItem[];
  closures: AccountabilityClosureItem[];
}

export interface AccountabilityAccountListItem {
  user: AccountabilityUserSummary;
  accountId: string;
  status: string;
  summary: AccountabilitySummary;
}

export interface CreateAccountabilityFundingPayload {
  amount: number;
  comment?: string;
}

export interface SaveAccountabilityExpensePayload {
  amount: number;
  description: string;
}
