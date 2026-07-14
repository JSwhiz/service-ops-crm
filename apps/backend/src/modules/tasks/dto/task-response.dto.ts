export class TaskResponseDto {
  id!: string;
  title!: string;
  description!: string | null;
  priority!: string;
  status!: string;
  targetType!: 'object' | 'one_time_order' | 'both' | 'none';
  targetId!: string;
  targetName!: string;
  objectId!: string | null;
  objectName!: string | null;
  oneTimeOrderId!: string | null;
  oneTimeOrderTitle!: string | null;
  object!: { id: string; name: string } | null;
  oneTimeOrder!: { id: string; title: string } | null;
  requiresConfirmation!: boolean;
  completionRequirement!: string;
  dueAt!: string | null;
  dueTimeSpecified!: boolean;
  isOverdue!: boolean;
  autoCloseAt!: string | null;
  autoCloseRemainingSeconds!: number | null;
  workCycle!: number;
  completedAt!: string | null;
  cancelledAt!: string | null;
  cancellationReason!: string | null;
  resultText!: string | null;
  submittedAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  submittedBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  assignees!: Array<{
    id: string;
    login: string;
    fullName: string;
    isActive: boolean;
    isCompleted: boolean;
    completedAt: string | null;
  }>;
  completionProgress!: {
    completed: number;
    total: number;
  };
  visibilityMode!: string;
  visibleUsers!: Array<{
    id: string;
    login: string;
    fullName: string;
  }>;
  myAssignment!: {
    assigneeId: string;
    isCompleted: boolean;
    completedAt: string | null;
  } | null;
  capabilities!: {
    canSubmitResult: boolean;
    allowedStatusTransitions: string[];
    canEdit: boolean;
    canManageAssignees: boolean;
    canCompleteMyAssignment: boolean;
    canUndoMyCompletion: boolean;
    canConfirm: boolean;
    canCompleteNow: boolean;
    canReturnToWork: boolean;
    canReopen: boolean;
    canCancel: boolean;
    canViewHistory: boolean;
  };
}

export class TaskListResponseDto {
  items!: TaskResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
