import { FileResponseDto } from '../../files/dto/file-response.dto';

export class ObjectDailyReportResponseDto {
  revision!: number;
  submittedRevision!: number;
  id!: string;
  objectId!: string;
  reportDate!: string;
  content!: string;
  createdAt!: string;
  updatedAt!: string;
  updatedBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  attachments!: FileResponseDto[];
}
