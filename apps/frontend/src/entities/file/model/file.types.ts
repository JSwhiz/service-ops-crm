export interface FilePreviewItem {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  viewUrl?: string;
  downloadUrl?: string;
}

export type AttachedFile = FilePreviewItem;

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
