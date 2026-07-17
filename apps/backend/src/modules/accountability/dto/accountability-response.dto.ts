import { SafeFileResponseDto } from '../../files/dto/safe-file-response.dto';

export class AccountabilityUserSummaryDto {
  id!: string;
  login!: string;
  fullName!: string;
  roleCodes!: string[];
}

export class AccountabilityFundingResponseDto {
  id!: string;
  amount!: number;
  comment!: string | null;
  issuedAt!: string;
  fundingType!: string;
  entryDirection!: string;
  oneTimeOrderPaymentId!: string | null;
  oneTimeOrderId!: string | null;
  oneTimeOrderCompletionId!: string | null;
  issuedBy!: AccountabilityUserSummaryDto;
  recordedBy!: AccountabilityUserSummaryDto | null;
}

export class AccountabilityExpenseResponseDto {
  id!: string;
  oneTimeOrderId!: string | null;
  oneTimeOrderCompletionId!: string | null;
  expenseCategory!: string | null;
  expenseDate!: string | null;
  amount!: number;
  description!: string;
  status!: string;
  submittedAt!: string | null;
  approvedAt!: string | null;
  rejectedAt!: string | null;
  rejectionComment!: string | null;
  reconciledAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: AccountabilityUserSummaryDto;
  approvedBy!: AccountabilityUserSummaryDto | null;
  rejectedBy!: AccountabilityUserSummaryDto | null;
  attachments!: SafeFileResponseDto[];
  capabilities!: {
    canEdit: boolean;
    canSubmit: boolean;
    canApprove: boolean;
    canReject: boolean;
  };
}

export class AccountabilityClosureResponseDto {
  id!: string;
  status!: string;
  requestedAt!: string;
  approvedAt!: string | null;
  rejectedAt!: string | null;
  comment!: string | null;
  requestedBy!: AccountabilityUserSummaryDto;
  approvedBy!: AccountabilityUserSummaryDto | null;
  rejectedBy!: AccountabilityUserSummaryDto | null;
  capabilities!: {
    canApprove: boolean;
    canReject: boolean;
  };
}

export class AccountabilityAccountSummaryDto {
  totalFunding!: number;
  totalCredits!: number;
  totalDebits!: number;
  totalRecordedExpenses!: number;
  totalApprovedExpenses!: number;
  totalRejectedExpenses!: number;
  totalReconciledExpenses!: number;
  currentBalance!: number;
  forecastBalance!: number;
  submittedExpensesCount!: number;
  draftExpensesCount!: number;
}

export class AccountabilityAccountViewDto {
  account!: {
    id: string | null;
    user: AccountabilityUserSummaryDto;
    status: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  summary!: AccountabilityAccountSummaryDto;
  capabilities!: {
    canCreateExpense: boolean;
    canRequestClosure: boolean;
    canIssueFunding: boolean;
    canReviewExpenses: boolean;
    canApproveAccountabilityClosure: boolean;
  };
  fundings!: AccountabilityFundingResponseDto[];
  expenses!: AccountabilityExpenseResponseDto[];
  closures!: AccountabilityClosureResponseDto[];
}

export class AccountabilityAccountListItemDto {
  user!: AccountabilityUserSummaryDto;
  accountId!: string;
  status!: string;
  summary!: AccountabilityAccountSummaryDto;
}

export class OneTimeOrderAccountabilityAccountDto {
  accountId!: string;
  accountStatus!: string;
  user!: AccountabilityUserSummaryDto;
  summary!: AccountabilityAccountSummaryDto;
  fundings!: AccountabilityFundingResponseDto[];
  expenses!: AccountabilityExpenseResponseDto[];
}

export class OneTimeOrderAccountabilityViewDto {
  order!: {
    id: string;
    title: string;
  };
  visibilityScope!: 'own' | 'administrative';
  capabilities!: {
    canCreateExpense: boolean;
    canReviewExpenses: boolean;
  };
  accounts!: OneTimeOrderAccountabilityAccountDto[];
}
