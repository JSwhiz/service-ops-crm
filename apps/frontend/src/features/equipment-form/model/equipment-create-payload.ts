import type { CreateEquipmentCatalogItemPayload, CreateEquipmentUnitPayload } from '@/entities/equipment/model/equipment.types';

export interface EquipmentTypeValues { category: string; name: string; brand: string; model: string; notes: string }
export interface EquipmentUnitValues { catalogItemId: string; inventoryNumber: string; serialNumber: string; notes: string }
export function equipmentTypePayload(value: EquipmentTypeValues): CreateEquipmentCatalogItemPayload {
  return { category: value.category, name: value.name, ...(value.brand.trim() ? { brand: value.brand } : {}), ...(value.model.trim() ? { model: value.model } : {}), ...(value.notes.trim() ? { notes: value.notes } : {}) };
}
export function equipmentUnitPayload(value: EquipmentUnitValues): CreateEquipmentUnitPayload {
  return { catalogItemId: value.catalogItemId, inventoryNumber: value.inventoryNumber, ...(value.serialNumber.trim() ? { serialNumber: value.serialNumber } : {}), ...(value.notes.trim() ? { notes: value.notes } : {}) };
}
