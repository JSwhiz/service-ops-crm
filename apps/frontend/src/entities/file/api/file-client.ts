import { fetcher } from '@/shared/api/fetcher';
import { appConfig } from '@/shared/config/app-config';

import type { AttachedFile, FileView } from '../model/file.types';

export async function listFilesByEntity(
  entityType: string,
  entityId: string,
): Promise<AttachedFile[]> {
  return fetcher<AttachedFile[]>(`/files/entity/${entityType}/${entityId}`, {
    method: 'GET',
  });
}

export async function uploadFileToEntity(params: {
  entityType: string;
  entityId: string;
  file: File;
  fieldCode?: string;
}): Promise<AttachedFile> {
  const formData = new FormData();
  formData.set('entityType', params.entityType);
  formData.set('entityId', params.entityId);

  if (params.fieldCode) {
    formData.set('fieldCode', params.fieldCode);
  }

  formData.set('file', params.file);

  return fetcher<AttachedFile>('/files/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function getFileView(fileId: string): Promise<FileView> {
  return fetcher<FileView>(`/files/${fileId}/view`, { method: 'GET' });
}

export async function retryFilePreview(fileId: string): Promise<FileView> {
  return fetcher<FileView>(`/files/${fileId}/preview/retry`, {
    method: 'POST',
  });
}

export function resolveFileApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const apiUrl = new URL(appConfig.apiUrl);
  return new URL(path, apiUrl.origin).toString();
}

export function buildFileViewerUrl(fileId: string): string {
  return `/files/${fileId}/view`;
}

export function buildFileDownloadUrl(fileId: string): string {
  return `${appConfig.apiUrl}/files/${fileId}/content?download=1`;
}
