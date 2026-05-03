export class ApprovalRequestUserSummaryDto {
  id!: string;
  login!: string;
  fullName!: string;
}

export class ApprovalRequestResponseDto {
  id!: string;
  approvalType!: string;
  sourceEntityType!: string;
  sourceEntityId!: string;
  status!: string;
  decisionComment!: string | null;
  payloadSnapshot!: Record<string, unknown>;
  createdAt!: string;
  updatedAt!: string;
  resolvedAt!: string | null;
  cancelledAt!: string | null;
  createdBy!: ApprovalRequestUserSummaryDto;
  resolvedBy!: ApprovalRequestUserSummaryDto | null;
  cancelledBy!: ApprovalRequestUserSummaryDto | null;
  summary!: {
    title: string;
    subtitle: string | null;
  };
  capabilities!: {
    canApprove: boolean;
    canReject: boolean;
    canCancel: boolean;
  };
}
