import { fetcher } from '@/shared/api/fetcher';

import type {
  CreateEquipmentCatalogItemPayload,
  CreateEquipmentMovementPayload,
  CreateEquipmentUnitPayload,
  EquipmentCatalogItem,
  EquipmentMovement,
  EquipmentScope,
  EquipmentUnit,
  ListEquipmentUnitsParams,
} from '../model/equipment.types';

function buildQuery(
  params?: Record<string, string | number | boolean | undefined>,
): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function listEquipmentCatalog(): Promise<EquipmentCatalogItem[]> {
  return fetcher<EquipmentCatalogItem[]>('/equipment/catalog', { method: 'GET' });
}

export async function createEquipmentCatalogItem(
  payload: CreateEquipmentCatalogItemPayload,
): Promise<EquipmentCatalogItem> {
  return fetcher<EquipmentCatalogItem>('/equipment/catalog', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listEquipmentUnits(
  params?: ListEquipmentUnitsParams,
): Promise<EquipmentUnit[]> {
  return fetcher<EquipmentUnit[]>(
    `/equipment/units${buildQuery(params as Record<string, string | undefined>)}`,
    { method: 'GET' },
  );
}

export async function createEquipmentUnit(
  payload: CreateEquipmentUnitPayload,
): Promise<EquipmentUnit> {
  return fetcher<EquipmentUnit>('/equipment/units', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getEquipmentUnitById(id: string): Promise<EquipmentUnit> {
  return fetcher<EquipmentUnit>(`/equipment/units/${id}`, { method: 'GET' });
}

export async function listEquipmentMovements(
  unitId: string,
): Promise<EquipmentMovement[]> {
  return fetcher<EquipmentMovement[]>(`/equipment/units/${unitId}/movements`, {
    method: 'GET',
  });
}

export async function createEquipmentMovement(
  unitId: string,
  payload: CreateEquipmentMovementPayload,
): Promise<EquipmentMovement> {
  return fetcher<EquipmentMovement>(`/equipment/units/${unitId}/movements`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getObjectEquipment(objectId: string): Promise<EquipmentScope> {
  return fetcher<EquipmentScope>(`/objects/${objectId}/equipment`, {
    method: 'GET',
  });
}

export async function getOneTimeOrderEquipment(
  orderId: string,
): Promise<EquipmentScope> {
  return fetcher<EquipmentScope>(`/one-time-orders/${orderId}/equipment`, {
    method: 'GET',
  });
}
