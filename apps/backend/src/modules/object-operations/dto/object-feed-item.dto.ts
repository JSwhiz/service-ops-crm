import { FileResponseDto } from '../../files/dto/file-response.dto';

export class ObjectFeedItemDto {
  type!: 'arrival_photo' | 'daily_report' | 'comment';
  id!: string;
  occurredAt!: string;
  title!: string;
  description!: string;
  attachments!: FileResponseDto[];
  author!: {
    id: string;
    login: string;
    fullName: string;
  };
}
