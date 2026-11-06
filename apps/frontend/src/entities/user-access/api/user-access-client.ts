import { fetcher } from '@/shared/api/fetcher';
import type { AccessCatalog, AccessDetail, AccessHistoryEntry, AccessPage, AccessPayload, AccessPreview, AccessResourcePage, AccessSaveResult, AccessUser } from '../model/user-access.types';

const base = '/users-access/admin';
const userPath = (id: string): string => `${base}/users/${encodeURIComponent(id)}`;

export function getAccessCatalog(signal?: AbortSignal): Promise<AccessCatalog> {
  return fetcher(`${base}/catalog`, { signal });
}
export function getAccessResources(resourceType: string, query: { q?: string; ids?: string[] } = {}, signal?: AbortSignal): Promise<AccessResourcePage> {
  const params = new URLSearchParams({ resourceType });
  if (query.q) params.set('q', query.q);
  if (query.ids?.length) params.set('ids', query.ids.join(','));
  return fetcher(`${base}/resources?${params}`, { signal });
}
export function listAccessUsers(q = '', offset = 0, limit = 30, signal?: AbortSignal): Promise<AccessPage<AccessUser>> {
  return fetcher(`${base}/users?${new URLSearchParams({ q, offset: String(offset), limit: String(limit) })}`, { signal });
}
export function getUserAccess(id: string, signal?: AbortSignal): Promise<AccessDetail> {
  return fetcher(userPath(id), { signal });
}
export function getAccessHistory(id: string, offset = 0, signal?: AbortSignal): Promise<AccessPage<AccessHistoryEntry>> {
  return fetcher(`${userPath(id)}/history?${new URLSearchParams({ offset: String(offset), limit: '30' })}`, { signal });
}
export function previewUserAccess(id: string, payload: AccessPayload): Promise<AccessPreview> {
  return fetcher(`${userPath(id)}/preview`, { method: 'POST', body: JSON.stringify(payload) });
}
export function saveUserAccess(id: string, payload: AccessPayload, preview: AccessPreview): Promise<AccessSaveResult> {
  return fetcher(`${userPath(id)}/save`, { method: 'POST', body: JSON.stringify({ ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash }) });
}
