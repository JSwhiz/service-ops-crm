import { FileResponseDto } from '../../files/dto/file-response.dto';

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
  issuedBy!: AccountabilityUserSummaryDto;
}

export class AccountabilityExpenseResponseDto {
  id!: string;
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
  attachments!: FileResponseDto[];
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
  totalRecordedExpenses!: number;
  totalApprovedExpenses!: number;
  totalRejectedExpenses!: number;
  totalReconciledExpenses!: number;
  currentBalance!: number;
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
