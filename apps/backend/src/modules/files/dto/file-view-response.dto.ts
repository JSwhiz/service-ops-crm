import type {
  FilePreviewStatus,
  FilePreviewType,
} from '../constants/file-preview.constants';

export class FileViewResponseDto {
  id!: string;
  originalName!: string;
  mimeType!: string;
  sizeBytes!: number;
  previewType!: FilePreviewType;
  previewStatus!: FilePreviewStatus;
  thumbnailUrl!: string | null;
  inlineContentUrl!: string | null;
  downloadUrl!: string;
  errorMessage!: string | null;
}
