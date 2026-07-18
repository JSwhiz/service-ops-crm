import { fetcher } from '@/shared/api/fetcher';

import type {
  CreateInventoryItemPayload,
  CreateInventoryMovementPayload,
  InventoryItem,
  InventoryItemListResponse,
  InventoryMovement,
  InventoryMovementListResponse,
  InventoryObjectReference,
  InventoryOneTimeOrderReference,
  ObjectInventory,
  ListInventoryItemsParams,
  ListInventoryMovementsParams,
  UpdateInventoryItemPayload,
} from '../model/inventory.types';

function buildQuery(
  params?:
    | Record<string, string | number | boolean | undefined>
    | undefined,
): string {
  if (!params) {
    return '';
  }

  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export async function listInventoryItems(
  params?: ListInventoryItemsParams,
): Promise<InventoryItemListResponse> {
  return fetcher<InventoryItemListResponse>(
    `/inventory/items${buildQuery(
      params as Record<string, string | number | boolean | undefined> | undefined,
    )}`,
    {
      method: 'GET',
    },
  );
}

export async function getInventoryItemById(id: string): Promise<InventoryItem> {
  return fetcher<InventoryItem>(`/inventory/items/${id}`, {
    method: 'GET',
  });
}

export async function createInventoryItem(
  payload: CreateInventoryItemPayload,
): Promise<InventoryItem> {
  return fetcher<InventoryItem>('/inventory/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateInventoryItem(
  id: string,
  payload: UpdateInventoryItemPayload,
): Promise<InventoryItem> {
  return fetcher<InventoryItem>(`/inventory/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function listInventoryMovements(
  params?: ListInventoryMovementsParams,
): Promise<InventoryMovementListResponse> {
  return fetcher<InventoryMovementListResponse>(
    `/inventory/movements${buildQuery(
      params as Record<string, string | number | boolean | undefined> | undefined,
    )}`,
    {
      method: 'GET',
    },
  );
}

export async function createInventoryMovement(
  payload: CreateInventoryMovementPayload,
): Promise<InventoryMovement> {
  return fetcher<InventoryMovement>('/inventory/movements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resolveInventoryMissingPhotoApproval(
  movementId: string,
): Promise<InventoryMovement> {
  return fetcher<InventoryMovement>(
    `/inventory/movements/${movementId}/resolve-missing-photo-approval`,
    {
      method: 'POST',
    },
  );
}

export async function getObjectInventory(
  objectId: string,
): Promise<ObjectInventory> {
  return fetcher<ObjectInventory>(`/objects/${objectId}/inventory`, {
    method: 'GET',
  });
}

export async function createObjectInventoryIssue(
  objectId: string,
  payload: {
    inventoryItemId: string;
    quantity: number;
    comment?: string;
  },
): Promise<InventoryMovement> {
  return fetcher<InventoryMovement>(`/objects/${objectId}/inventory/issue`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listInventoryObjectReferenceOptions(): Promise<
  InventoryObjectReference[]
> {
  return fetcher<InventoryObjectReference[]>('/inventory/reference/objects', {
    method: 'GET',
  });
}

export async function listInventoryOneTimeOrderReferenceOptions(): Promise<
  InventoryOneTimeOrderReference[]
> {
  return fetcher<InventoryOneTimeOrderReference[]>(
    '/inventory/reference/one-time-orders',
    {
      method: 'GET',
    },
  );
}
