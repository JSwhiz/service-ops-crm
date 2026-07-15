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
  'one_time_manager_availability',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_SOURCE_ENTITY_TYPES = [
  'task',
  'inventory_movement',
  'equipment_movement',
  'object',
  'accountability_closure',
  'timesheet_exception',
  'one_time_manager_availability',
] as const;

export type ApprovalSourceEntityType =
  (typeof APPROVAL_SOURCE_ENTITY_TYPES)[number];

export const TASK_RESULT_CONFIRMATION_TYPE: ApprovalType =
  'task_result_confirmation';
export const INVENTORY_EXCEPTION_CONFIRMATION_TYPE: ApprovalType =
  'inventory_exception_confirmation';
export const INVENTORY_WRITEOFF_CONFIRMATION_TYPE: ApprovalType =
  'inventory_writeoff_confirmation';
export const EQUIPMENT_WRITEOFF_CONFIRMATION_TYPE: ApprovalType =
  'equipment_writeoff_confirmation';
export const OBJECT_CHANGE_CONFIRMATION_TYPE: ApprovalType =
  'object_change_confirmation';
export const ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE: ApprovalType =
  'accountability_closure_confirmation';
export const MANUAL_TIMESHEET_EXCEPTION_CONFIRMATION_TYPE: ApprovalType =
  'manual_timesheet_exception_confirmation';
export const ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_TYPE: ApprovalType =
  'one_time_manager_availability';

export const TASK_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType = 'task';
export const INVENTORY_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'inventory_movement';
export const EQUIPMENT_MOVEMENT_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'equipment_movement';
export const OBJECT_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'object';
export const ACCOUNTABILITY_CLOSURE_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'accountability_closure';
export const TIMESHEET_EXCEPTION_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'timesheet_exception';
export const ONE_TIME_MANAGER_AVAILABILITY_APPROVAL_SOURCE_ENTITY_TYPE: ApprovalSourceEntityType =
  'one_time_manager_availability';

export const LEGACY_INVENTORY_MISSING_PHOTO_BRIDGE_TYPE =
  'inventory_without_photo_confirmation';
