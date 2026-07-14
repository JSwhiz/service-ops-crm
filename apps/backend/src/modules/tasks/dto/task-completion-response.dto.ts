import { SafeFileResponseDto } from '../../files/dto/safe-file-response.dto';

export class TaskCompletionAttachmentDto extends SafeFileResponseDto {}

export class TaskCompletionResponseDto {
  id!: string;
  workCycle!: number;
  attemptNumber!: number;
  status!: string;
  completionText!: string | null;
  submittedAt!: string;
  cancelledAt!: string | null;
  cancellationReason!: string | null;
  assignee!: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments!: TaskCompletionAttachmentDto[];
}

export class TaskCompletionListResponseDto {
  items!: TaskCompletionResponseDto[];
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}
