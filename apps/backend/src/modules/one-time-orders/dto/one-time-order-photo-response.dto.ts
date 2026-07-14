import { FileResponseDto } from '../../files/dto/file-response.dto';

export class OneTimeOrderPhotoResponseDto {
  id!: string;
  oneTimeOrderId!: string;
  category!: string;
  comment!: string | null;
  createdAt!: string;
  updatedAt!: string;
  createdBy!: {
    id: string;
    login: string;
    fullName: string;
  };
  deletedAt!: string | null;
  deletedBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  deleteReason!: string | null;
  restoredAt!: string | null;
  restoredBy!: {
    id: string;
    login: string;
    fullName: string;
  } | null;
  capabilities!: {
    canDelete: boolean;
    canRestore: boolean;
  };
  attachments!: FileResponseDto[];
}
