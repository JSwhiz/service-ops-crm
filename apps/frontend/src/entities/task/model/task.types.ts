import type { FilePreviewItem } from '@/entities/file/model/file.types';

export type TaskPriority =
  | 'urgent_important'
  | 'urgent_not_important'
  | 'important_not_urgent'
  | 'not_important_not_urgent';

export type TaskStatus =
  | 'in_progress'
  | 'awaiting_confirmation'
  | 'pending_auto_close'
  | 'completed'
  | 'cancelled';

export type TaskCompletionRequirement =
  | 'none'
  | 'comment_or_file'
  | 'comment_required'
  | 'file_required';

export interface TaskUser {
  id: string;
  login: string;
  fullName: string;
}

export interface TaskCompletion {
  id: string;
  completionText: string | null;
  status: string;
  submittedAt: string;
  attachments: FilePreviewItem[];
}

export interface TaskAssignee extends TaskUser {
  isActive: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  currentCompletion: TaskCompletion | null;
  completionHistoryCount: number;
}

export interface TaskCapabilities {
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
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus | string;
  targetType: 'object' | 'one_time_order' | 'both' | 'none';
  targetId: string;
  targetName: string;
  objectId: string | null;
  objectName: string | null;
  oneTimeOrderId: string | null;
  oneTimeOrderTitle: string | null;
  object: { id: string; name: string } | null;
  oneTimeOrder: { id: string; title: string } | null;
  requiresConfirmation: boolean;
  completionRequirement: TaskCompletionRequirement;
  dueAt: string | null;
  dueTimeSpecified: boolean;
  isOverdue: boolean;
  autoCloseAt: string | null;
  autoCloseRemainingSeconds: number | null;
  workCycle: number;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  resultText: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: TaskUser;
  submittedBy: TaskUser | null;
  assignees: TaskAssignee[];
  completionProgress: { completed: number; total: number };
  visibilityMode: 'scope' | 'selected';
  visibleUsers: TaskUser[];
  myAssignment: {
    assigneeId: string;
    isCompleted: boolean;
    completedAt: string | null;
    currentCompletion: TaskCompletion | null;
  } | null;
  capabilities: TaskCapabilities;
}

export interface TaskListResponse {
  items: TaskItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TaskListQuery {
  q?: string;
  status?: string;
  objectId?: string;
  oneTimeOrderId?: string;
  creatorUserId?: string;
  assigneeUserId?: string;
  assignedToMe?: boolean;
  createdByMe?: boolean;
  myObjects?: boolean;
  overdue?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'dueAt' | 'title';
  sortDirection?: 'asc' | 'desc';
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority: TaskPriority;
  objectId?: string;
  oneTimeOrderId?: string;
  assigneeUserIds: string[];
  visibilityMode: 'scope' | 'selected';
  visibleUserIds?: string[];
  requiresConfirmation: boolean;
  completionRequirement: TaskCompletionRequirement;
  dueDate?: string | null;
  dueTime?: string | null;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  objectId?: string | null;
  oneTimeOrderId?: string | null;
  visibilityMode?: 'scope' | 'selected';
  visibleUserIds?: string[];
  requiresConfirmation?: boolean;
  completionRequirement?: TaskCompletionRequirement;
  dueDate?: string | null;
  dueTime?: string | null;
  resetCompletions?: boolean;
}

export interface TaskHistoryEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  actor: TaskUser | null;
}

export interface TaskCompletionHistoryItem {
  id: string;
  workCycle: number;
  attemptNumber: number;
  status: string;
  completionText: string | null;
  submittedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  assignee: TaskUser;
  attachments: FilePreviewItem[];
}

export interface TaskCompletionListResponse {
  items: TaskCompletionHistoryItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TaskCompletionListQuery {
  assigneeUserId?: string;
  workCycle?: number;
  page?: number;
  limit?: number;
}
