export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_TYPES = [
  'task_result_confirmation',
  'inventory_exception_confirmation',
  'inventory_return_confirmation',
  'inventory_writeoff_confirmation',
  'equipment_return_confirmation',
  'equipment_writeoff_confirmation',
  'object_change_confirmation',
  'accountability_closure_confirmation',
  'manual_timesheet_exception_confirmation',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_SOURCE_ENTITY_TYPES = [
  'task',
  'inventory_movement',
  'equipment_movement',
  'object',
  'accountability_closure',
  'timesheet_exception',
] as const;

export type ApprovalSourceEntityType =
  (typeof APPROVAL_SOURCE_ENTITY_TYPES)[number];

export const TASK_RESULT_CONFIRMATION_TYPE: ApprovalType =
  'task_result_confirmation';
export const INVENTORY_EXCEPTION_CONFIRMATION_TYPE: ApprovalType =
  'inventory_exception_confirmation';
export const ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE: ApprovalType =
  'accountability_closure_confirmation';

export const TASK_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType = 'task';
export const INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'inventory_movement';
export const ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'accountability_closure';

export const LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE =
  'inventory_without_photo_confirmation';
