import { FileResponseDto } from '../../files/dto/file-response.dto';

export class ObjectArrivalPhotoResponseDto {
  id!: string;
  objectId!: string;
  operationDate!: string;
  photoUrl!: string | null;
  photoType!: string | null;
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
