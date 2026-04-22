export const EQUIPMENT_STATUSES = [
  'in_storage',
  'assigned_to_object',
  'assigned_to_one_time_order',
  'under_repair',
  'broken',
  'lost',
  'written_off',
] as const;

export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_MOVEMENT_TYPES = [
  'issue_to_object',
  'issue_to_one_time_order',
  'return_to_storage',
  'send_to_repair',
  'return_from_repair',
  'mark_broken',
  'mark_lost',
  'writeoff',
] as const;

export type EquipmentMovementType = (typeof EQUIPMENT_MOVEMENT_TYPES)[number];
