export interface ApprovalRequestItem {
  id: string;
  approvalType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  status: string;
  decisionComment: string | null;
  payloadSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  resolvedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  cancelledBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  summary: {
    title: string;
    subtitle: string | null;
  };
  capabilities: {
    canApprove: boolean;
    canReject: boolean;
    canCancel: boolean;
  };
}

export interface ListApprovalRequestsParams {
  status?: string;
  approvalType?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ApprovalRequestPage {
  items: ApprovalRequestItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListApprovalRequestsPageParams extends ListApprovalRequestsParams {
  page: number;
  limit: number;
}
