export class FileAttachmentResponseDto {
  id!: string;
  entityType!: string;
  entityId!: string;
  fieldCode!: string | null;
  uploadedByUserId!: string | null;
  createdAt!: string;
}
