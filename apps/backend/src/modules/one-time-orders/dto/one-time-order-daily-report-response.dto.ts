import { SafeFileResponseDto } from '../../files/dto/safe-file-response.dto';

export class OneTimeOrderDailyReportResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  reportDate!: string;
  content!: string;
  createdAt!: string;
  updatedAt!: string;
  updatedBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments!: SafeFileResponseDto[];
}
