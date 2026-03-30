export class TaskResponseDto {
  id!: string;
  title!: string;
  description!: string | null;
  priority!: string;
  status!: string;
  objectId!: string;
  objectName!: string;
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
}
