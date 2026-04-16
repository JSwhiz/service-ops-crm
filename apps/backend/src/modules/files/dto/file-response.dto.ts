import { FileAttachmentResponseDto } from './file-attachment-response.dto';

export class FileResponseDto {
  id!: string;
  bucket!: string;
  objectKey!: string;
  originalName!: string;
  mimeType!: string;
  sizeBytes!: number;
  uploadedByUserId!: string | null;
  createdAt!: string;
  url!: string;
  attachments!: FileAttachmentResponseDto[];
}
