export interface FilePreviewItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  viewUrl?: string;
  downloadUrl?: string;
}

export interface AttachedFile extends FilePreviewItem {
  bucket: string;
  objectKey: string;
  uploadedByUserId: string | null;
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
