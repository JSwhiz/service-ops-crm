import { SafeFileResponseDto } from '../dto/safe-file-response.dto';

export function mapSafeFileResponse(file: {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): SafeFileResponseDto {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt.toISOString(),
    viewUrl: `/api/v1/files/${file.id}/view`,
    downloadUrl: `/api/v1/files/${file.id}/content?download=1`,
  };
}
