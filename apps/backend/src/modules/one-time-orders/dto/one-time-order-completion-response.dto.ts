export class OneTimeOrderCompletionResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  workCycle!: number;
  completedAt!: string;
  completedBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  completionComment!: string | null;
  status!: string;
  clientRequestId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}
