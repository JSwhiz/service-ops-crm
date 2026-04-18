export class TaskResponseDto {
  id!: string;
  title!: string;
  description!: string | null;
  priority!: string;
  status!: string;
  targetType!: 'object' | 'one_time_order';
  targetId!: string;
  targetName!: string;
  objectId!: string | null;
  objectName!: string | null;
  oneTimeOrderId!: string | null;
  oneTimeOrderTitle!: string | null;
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
    isCompleted: boolean;
    completedAt: string | null;
  }>;
  capabilities!: {
    canSubmitResult: boolean;
    allowedStatusTransitions: string[];
  };
}
