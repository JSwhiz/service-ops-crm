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
  fundingType: string;
  entryDirection: string;
  oneTimeOrderPaymentId: string | null;
  oneTimeOrderId: string | null;
  oneTimeOrderCompletionId: string | null;
  issuedBy: AccountabilityUserSummary;
  recordedBy: AccountabilityUserSummary | null;
}

export interface AccountabilityExpenseItem {
  id: string;
  oneTimeOrderId: string | null;
  oneTimeOrderCompletionId: string | null;
  expenseCategory: string | null;
  expenseDate: string | null;
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
  totalCredits: number;
  totalDebits: number;
  totalRecordedExpenses: number;
  totalApprovedExpenses: number;
  totalRejectedExpenses: number;
  totalReconciledExpenses: number;
  currentBalance: number;
  forecastBalance: number;
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
  oneTimeOrderId?: string;
  oneTimeOrderCompletionId?: string | null;
  expenseCategory?: AccountabilityExpenseCategory;
  expenseDate?: string;
}

export type AccountabilityExpenseCategory =
  | 'consumables'
  | 'delivery'
  | 'transport'
  | 'services'
  | 'other';

export interface OneTimeOrderAccountabilityView {
  order: {
    id: string;
    title: string;
  };
  visibilityScope: 'own' | 'administrative';
  capabilities: {
    canCreateExpense: boolean;
    canReviewExpenses: boolean;
  };
  accounts: Array<{
    accountId: string;
    accountStatus: string;
    user: AccountabilityUserSummary;
    summary: AccountabilitySummary;
    fundings: AccountabilityFundingEntry[];
    expenses: AccountabilityExpenseItem[];
  }>;
}
