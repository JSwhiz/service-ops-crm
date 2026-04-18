export interface TaskAssignee {
  id: string;
  login: string;
  fullName: string;
  isCompleted: boolean;
  completedAt: string | null;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  targetType: 'object' | 'one_time_order';
  targetId: string;
  targetName: string;
  objectId: string | null;
  objectName: string | null;
  oneTimeOrderId: string | null;
  oneTimeOrderTitle: string | null;
  resultText: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    login: string;
    fullName: string;
  };
  submittedBy: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  assignees: TaskAssignee[];
  capabilities: {
    canSubmitResult: boolean;
    allowedStatusTransitions: string[];
  };
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority:
    | 'urgent_important'
    | 'urgent_not_important'
    | 'important_not_urgent'
    | 'not_important_not_urgent';
  objectId?: string;
  oneTimeOrderId?: string;
  assigneeUserIds: string[];
}
