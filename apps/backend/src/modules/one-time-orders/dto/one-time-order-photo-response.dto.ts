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
  attachments!: FileResponseDto[];
}
