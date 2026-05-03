import { canApproveAccountabilityClosure } from '../../accountability/utils/accountability-access.util';
import { canResolveInventoryMissingPhotoApproval } from '../../inventory/utils/inventory-access.util';
import { canEditObject, LEADERSHIP_OBJECT_ROLE_CODES } from '../../objects/utils/object-access.util';
import { hasWideTaskAccess } from '../../tasks/utils/task-access.util';
import { canManuallyCorrectTimesheet } from '../../timesheets/utils/timesheet-access.util';

import {
  ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
  ApprovalType,
  INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
  TASK_RESULT_CONFIRMATION_TYPE,
} from '../constants/approval.constants';

const TASK_RESULT_PERMISSION = 'approval.resolve_task_result';
const OBJECT_CHANGE_PERMISSION = 'approval.resolve_object_change';
const INVENTORY_EXCEPTION_PERMISSION = 'approval.resolve_inventory_exception';
const TIMESHEET_EXCEPTION_PERMISSION = 'timesheet.manual_correction';

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

function hasPermission(
  permissionCodes: string[] | undefined,
  permissionCode: string,
): boolean {
  return (permissionCodes ?? []).includes(permissionCode);
}

export interface ApprovalGlobalCapabilities {
  canAccessApprovals: boolean;
  canResolveTaskResultApproval: boolean;
  canResolveInventoryApproval: boolean;
  canResolveObjectChangeApproval: boolean;
  canResolveAccountabilityApproval: boolean;
  canResolveTimesheetApproval: boolean;
}

export function buildApprovalGlobalCapabilities(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): ApprovalGlobalCapabilities {
  const canResolveTaskResultApproval =
    hasWideTaskAccess(params.roleCodes) ||
    hasPermission(params.permissionCodes, TASK_RESULT_PERMISSION);
  const canResolveInventoryApproval =
    canResolveInventoryMissingPhotoApproval(params.roleCodes) ||
    hasPermission(params.permissionCodes, INVENTORY_EXCEPTION_PERMISSION);
  const canResolveObjectChangeApproval =
    canEditObject(params.roleCodes) ||
    hasPermission(params.permissionCodes, OBJECT_CHANGE_PERMISSION);
  const canResolveAccountabilityApproval =
    canApproveAccountabilityClosure(params) ||
    hasPermission(params.permissionCodes, 'expense.approve');
  const canResolveTimesheetApproval =
    canManuallyCorrectTimesheet(params.roleCodes) ||
    hasPermission(params.permissionCodes, TIMESHEET_EXCEPTION_PERMISSION);

  return {
    canAccessApprovals: true,
    canResolveTaskResultApproval,
    canResolveInventoryApproval,
    canResolveObjectChangeApproval,
    canResolveAccountabilityApproval,
    canResolveTimesheetApproval,
  };
}

export function canResolveApprovalType(params: {
  approvalType: ApprovalType;
  roleCodes: string[];
  permissionCodes?: string[];
}): boolean {
  switch (params.approvalType) {
    case TASK_RESULT_CONFIRMATION_TYPE:
      return (
        hasWideTaskAccess(params.roleCodes) ||
        hasPermission(params.permissionCodes, TASK_RESULT_PERMISSION)
      );
    case INVENTORY_EXCEPTION_CONFIRMATION_TYPE:
      return (
        canResolveInventoryMissingPhotoApproval(params.roleCodes) ||
        hasPermission(params.permissionCodes, INVENTORY_EXCEPTION_PERMISSION)
      );
    case ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE:
      return canApproveAccountabilityClosure(params);
    case 'object_change_confirmation':
      return (
        hasAnyRole(params.roleCodes, LEADERSHIP_OBJECT_ROLE_CODES) ||
        hasPermission(params.permissionCodes, OBJECT_CHANGE_PERMISSION)
      );
    case 'manual_timesheet_exception_confirmation':
      return (
        canManuallyCorrectTimesheet(params.roleCodes) ||
        hasPermission(params.permissionCodes, TIMESHEET_EXCEPTION_PERMISSION)
      );
    default:
      return false;
  }
}

export function getResolvableApprovalTypes(params: {
  roleCodes: string[];
  permissionCodes?: string[];
}): ApprovalType[] {
  const approvalTypes: ApprovalType[] = [
    TASK_RESULT_CONFIRMATION_TYPE,
    INVENTORY_EXCEPTION_CONFIRMATION_TYPE,
    ACCOUNTABILITY_CLOSURE_CONFIRMATION_TYPE,
    'object_change_confirmation',
    'manual_timesheet_exception_confirmation',
  ];

  return approvalTypes.filter((approvalType) =>
    canResolveApprovalType({
      approvalType,
      roleCodes: params.roleCodes,
      permissionCodes: params.permissionCodes,
    }),
  );
}
