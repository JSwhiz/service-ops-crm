import { SafeFileResponseDto } from '../../files/dto/safe-file-response.dto';

export class OneTimeOrderCommentResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  content!: string;
  commentType!: string;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments!: SafeFileResponseDto[];
}
