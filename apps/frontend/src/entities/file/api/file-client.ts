import { fetcher } from '@/shared/api/fetcher';
import { appConfig } from '@/shared/config/app-config';

import type { AttachedFile, FileView } from '../model/file.types';
const uploadIds = new WeakMap<File, Map<string, string>>();

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
  originalName?: string;
  fieldCode?: string;
}): Promise<AttachedFile> {
  const formData = new FormData();
  formData.set('entityType', params.entityType);
  formData.set('entityId', params.entityId);
  const target = `${params.entityType}:${params.entityId}:${params.fieldCode ?? ''}`;
  const ids = uploadIds.get(params.file) ?? new Map<string, string>();
  if (!ids.has(target)) ids.set(target, crypto.randomUUID());
  uploadIds.set(params.file, ids);
  formData.set('uploadId', ids.get(target)!);
  // Multipart filename headers are decoded inconsistently by some servers;
  // send the display name as a UTF-8 form field as well.
  formData.set('originalName', params.originalName ?? params.file.name);

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

/** Keep large photo selections from opening unbounded parallel requests. */
export async function uploadFileBatch(params: {
  entityType: string;
  entityId: string;
  files: File[];
}): Promise<PromiseSettledResult<AttachedFile>[]> {
  const results: PromiseSettledResult<AttachedFile>[] = new Array(params.files.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, params.files.length) }, async () => {
    while (cursor < params.files.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await uploadFileToEntity({ entityType: params.entityType, entityId: params.entityId, file: params.files[index]! }) };
      } catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
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
