export const INVENTORY_MOVEMENT_TYPES = [
  'receipt',
  'issue_to_object',
  'issue_to_one_time_order',
  'return',
  'writeoff',
  'adjustment',
] as const;

export type InventoryMovementType =
  (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const INVENTORY_ADJUSTMENT_DIRECTIONS = [
  'increase',
  'decrease',
] as const;

export type InventoryAdjustmentDirection =
  (typeof INVENTORY_ADJUSTMENT_DIRECTIONS)[number];

export function isSensitiveInventoryMovementType(
  movementType: InventoryMovementType,
): boolean {
  return movementType === 'writeoff' || movementType === 'adjustment';
}

export function defaultEvidenceRequiredForMovementType(
  movementType: InventoryMovementType,
): boolean {
  return (
    movementType === 'issue_to_object' ||
    movementType === 'issue_to_one_time_order' ||
    movementType === 'writeoff'
  );
}
