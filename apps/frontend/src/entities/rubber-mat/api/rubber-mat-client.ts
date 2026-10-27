import { fetcher } from '@/shared/api/fetcher';

export interface RubberMatSize {
  id: string; lengthCm: number; widthCm: number;
  replacementCost: string | null; version: number;
}
export interface RubberMatAggregate {
  canManage: boolean;
  items: Array<RubberMatSize & { quantity: number; quantityVersion: number }>;
  knownReplacementCost: string;
  totalReplacementCost: string | null;
}
export interface RubberMatQuantityChange {
  id: string; lengthCm: string; widthCm: string;
  beforeQuantity: number; afterQuantity: number;
  replacementCostSnapshot: string | null;
  actorName: string | null; source: string; occurredAt: string;
}
export interface RubberMatCostChange {
  id: string; beforeCost: string | null; afterCost: string | null;
  actorName: string | null; source: string; occurredAt: string;
}
export interface RubberMatAggregateRegistry {
  items: Array<{ object: { id: string; name: string; address: string }; quantity: number; totalReplacementCost: string | null; knownReplacementCost: string }>;
  page: number; total: number; totalPages: number;
}
export async function getRubberMatAggregateRegistry(q: string, page: number, limit: number): Promise<RubberMatAggregateRegistry> {
  const params = new URLSearchParams({ q, page: String(page), limit: String(limit) });
  return fetcher(`/rubber-mats/aggregate?${params}`, { method: 'GET' });
}
export const matSizeLabel = (size: { lengthCm: number | string; widthCm: number | string }): string => `${size.lengthCm} × ${size.widthCm} см`;
export const matMoney = (value: string | null): string => value === null ? 'Не указана' : `${value.replace('.', ',')} ₽`;
export async function getRubberMatCatalog(): Promise<{ items: RubberMatSize[]; canManage: boolean }> {
  return fetcher('/rubber-mats/catalog', { method: 'GET' });
}
export async function createRubberMatSize(payload: { lengthCm: number; widthCm: number; replacementCost: string | null }): Promise<RubberMatSize> {
  return fetcher('/rubber-mats/catalog', { method: 'POST', body: JSON.stringify(payload) });
}
export async function setRubberMatCost(id: string, payload: { version: number; replacementCost: string | null }): Promise<RubberMatSize> {
  return fetcher(`/rubber-mats/catalog/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function getRubberMatAggregate(objectId: string): Promise<RubberMatAggregate> {
  return fetcher(`/objects/${objectId}/rubber-mats/aggregate`, { method: 'GET' });
}
export async function setRubberMatQuantity(objectId: string, sizeId: string, payload: { version: number; quantity: number }): Promise<{ quantity: number; version: number }> {
  return fetcher(`/objects/${objectId}/rubber-mats/aggregate/${sizeId}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function getRubberMatQuantityHistory(objectId: string): Promise<RubberMatQuantityChange[]> {
  return fetcher(`/objects/${objectId}/rubber-mats/aggregate/history`, { method: 'GET' });
}
export async function getRubberMatCostHistory(sizeId: string): Promise<RubberMatCostChange[]> {
  return fetcher(`/rubber-mats/catalog/${sizeId}/history`, { method: 'GET' });
}

export type RubberMatCondition = 'good' | 'worn' | 'damaged' | 'retired';

export interface RubberMatItem {
  id: string;
  inventoryCode: string | null;
  objectId: string | null;
  zone: string | null;
  lengthCm: number;
  widthCm: number;
  thicknessMm: number | null;
  condition: RubberMatCondition;
  installedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RubberMatEvent {
  id: string;
  action: string;
  fromObjectId: string | null;
  toObjectId: string | null;
  fromCondition: RubberMatCondition | null;
  toCondition: RubberMatCondition | null;
  fromZone: string | null;
  toZone: string | null;
  note: string;
  occurredAt: string;
  actor: { id: string; fullName: string };
}

export interface RubberMatRegistryItem extends RubberMatItem {
  object: { id: string; name: string; internalName: string | null; address: string } | null;
}

export interface RubberMatRegistryPage {
  items: RubberMatRegistryItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RegisterRubberMatPayload {
  lengthCm: number;
  widthCm: number;
  thicknessMm?: number;
  inventoryCode?: string;
  notes?: string;
  note: string;
}

export interface ListRubberMatsParams {
  q?: string;
  objectId?: string;
  condition?: RubberMatCondition | '';
  page?: number;
  limit?: number;
}

export async function listRubberMatsRegistry(params: ListRubberMatsParams = {}): Promise<RubberMatRegistryPage> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set('q', params.q.trim());
  if (params.objectId) query.set('objectId', params.objectId);
  if (params.condition) query.set('condition', params.condition);
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));
  return fetcher<RubberMatRegistryPage>(`/rubber-mats?${query.toString()}`, { method: 'GET' });
}

export async function listRubberMats(objectId: string): Promise<RubberMatItem[]> {
  return fetcher<RubberMatItem[]>(`/objects/${objectId}/rubber-mats`, { method: 'GET' });
}

export async function registerRubberMat(payload: RegisterRubberMatPayload): Promise<RubberMatItem> {
  return fetcher<RubberMatItem>('/rubber-mats', { method: 'POST', body: JSON.stringify(payload) });
}

export async function listAvailableRubberMats(objectId: string): Promise<RubberMatItem[]> {
  return fetcher<RubberMatItem[]>(`/rubber-mats/available/${objectId}`, { method: 'GET' });
}

export async function assignRubberMat(objectId: string, matId: string, payload: { zone: string; note: string }): Promise<RubberMatItem> {
  return fetcher<RubberMatItem>(`/objects/${objectId}/rubber-mats/${matId}/assign`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function returnRubberMatToStock(objectId: string, matId: string, note: string): Promise<RubberMatItem> {
  return fetcher<RubberMatItem>(`/objects/${objectId}/rubber-mats/${matId}/return-to-stock`, { method: 'POST', body: JSON.stringify({ note }) });
}

export async function updateRubberMat(objectId: string, matId: string, payload: {
  condition?: RubberMatCondition;
  note: string;
}): Promise<RubberMatItem> {
  return fetcher<RubberMatItem>(`/objects/${objectId}/rubber-mats/${matId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function recordRubberMatService(objectId: string, matId: string, note: string): Promise<RubberMatEvent[]> {
  return fetcher<RubberMatEvent[]>(`/objects/${objectId}/rubber-mats/${matId}/service`, { method: 'POST', body: JSON.stringify({ note }) });
}

export async function getRubberMatHistory(objectId: string, matId: string): Promise<RubberMatEvent[]> {
  return fetcher<RubberMatEvent[]>(`/objects/${objectId}/rubber-mats/${matId}/history`, { method: 'GET' });
}

export async function moveRubberMat(objectId: string, matId: string, payload: { targetObjectId: string; zone: string; note: string }): Promise<RubberMatItem> {
  return fetcher<RubberMatItem>(`/objects/${objectId}/rubber-mats/${matId}/move`, { method: 'POST', body: JSON.stringify(payload) });
}
