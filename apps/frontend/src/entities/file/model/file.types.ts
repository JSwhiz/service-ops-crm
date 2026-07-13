export interface AttachedFile {
  id: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
  createdAt: string;
  url: string;
  attachments: Array<{
    id: string;
    entityType: string;
    entityId: string;
    fieldCode: string | null;
    uploadedByUserId: string | null;
    createdAt: string;
  }>;
}

export interface FileView {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  previewType: 'image' | 'pdf' | 'text' | 'unsupported';
  previewStatus: 'pending' | 'processing' | 'ready' | 'failed';
  thumbnailUrl: string | null;
  inlineContentUrl: string | null;
  downloadUrl: string;
  errorMessage: string | null;
}
