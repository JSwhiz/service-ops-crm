export const FILE_PREVIEW_QUEUE = 'service-ops:file-preview:jobs';

export const IMAGE_THUMBNAIL_DERIVATIVE = 'image_thumbnail';
export const PDF_PREVIEW_DERIVATIVE = 'preview_pdf';

export const FILE_PREVIEW_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
] as const;

export type FilePreviewStatus = (typeof FILE_PREVIEW_STATUSES)[number];
export type FilePreviewType = 'image' | 'pdf' | 'text' | 'unsupported';
export type FileDerivativeType =
  | typeof IMAGE_THUMBNAIL_DERIVATIVE
  | typeof PDF_PREVIEW_DERIVATIVE;

export const INLINE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const INLINE_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'application/json',
]);

export const OFFICE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

export const OFFICE_FILE_EXTENSIONS: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    '.pptx',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
};

export function getFilePreviewType(mimeType: string): FilePreviewType {
  if (INLINE_IMAGE_MIME_TYPES.has(mimeType)) {
    return 'image';
  }

  if (mimeType === 'application/pdf' || OFFICE_MIME_TYPES.has(mimeType)) {
    return 'pdf';
  }

  if (INLINE_TEXT_MIME_TYPES.has(mimeType)) {
    return 'text';
  }

  return 'unsupported';
}

export function getDerivativeType(
  mimeType: string,
): FileDerivativeType | null {
  if (INLINE_IMAGE_MIME_TYPES.has(mimeType)) {
    return IMAGE_THUMBNAIL_DERIVATIVE;
  }

  if (OFFICE_MIME_TYPES.has(mimeType)) {
    return PDF_PREVIEW_DERIVATIVE;
  }

  return null;
}
