import type { CreateInventoryItemPayload } from '@/entities/inventory/model/inventory.types';

export interface InventoryItemCreateValues {
  name: string;
  category: string;
  unit: string;
  notes: string;
}

export function toCreateInventoryItemPayload(
  value: InventoryItemCreateValues,
): CreateInventoryItemPayload {
  return {
    name: value.name,
    category: value.category,
    unit: value.unit,
    ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
  };
}
