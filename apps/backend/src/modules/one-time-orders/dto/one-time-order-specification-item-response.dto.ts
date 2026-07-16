import { SafeFileResponseDto } from '../../files/dto/safe-file-response.dto';

export class OneTimeOrderSpecificationItemResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  title!: string;
  description!: string | null;
  sortOrder!: number;
  requiresAttachment!: boolean;
  isCompleted!: boolean;
  completedAt!: string | null;
  completedBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  createdAt!: string;
  updatedAt!: string;
  attachments!: SafeFileResponseDto[];
}
