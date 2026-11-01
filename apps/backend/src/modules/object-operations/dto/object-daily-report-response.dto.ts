import { ObjectDailyReportAttachmentResponseDto } from './object-daily-report-attachment-response.dto';

export class ObjectDailyReportResponseDto {
  revision!: number;
  submittedRevision!: number;
  publicationState!: 'draft' | 'submitted' | 'draft_after_submission';
  capabilities!: { editAttachments: boolean };
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
  attachments!: ObjectDailyReportAttachmentResponseDto[];
}
