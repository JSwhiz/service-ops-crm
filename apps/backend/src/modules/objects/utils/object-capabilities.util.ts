import {
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectResponsibles,
  canOverrideObjectAttendanceRate,
  canOverrideFrozenObject,
  hasHrObjectView,
  hasWideObjectAccess,
} from './object-access.util';
import { canManageEmployeeAssignments } from '../../employees/utils/employee-hr-access.util';
import { hasDelegatedObjectAction } from '../../user-substitutions/object-delegation.context';

interface ObjectCapabilityAssignment {
  userId: string;
  roleCode: string;
}

export function buildObjectCapabilities(params: {
  objectId?: string;
  currentUserId: string;
  roleCodes: string[];
  permissionCodes: string[];
  objectStatus: string;
  createdByUserId: string;
  assignments: ObjectCapabilityAssignment[];
}): {
  canEdit: boolean;
  canEditDailyRate: boolean;
  canViewCompensationRates: boolean;
  canManageCompensationRates: boolean;
  canChangeStatus: boolean;
  canManageResponsibles: boolean;
  canManageManagers: boolean;
  canCreateTask: boolean;
  canViewBasicProfile: boolean;
  canViewOperationalSections: boolean;
  canViewReportsHistory: boolean;
  canManageEmployees: boolean;
  canViewEmployees: boolean;
  canOperateAttendance: boolean;
  canAddExtraShift: boolean;
} {
  const canManageResponsibles = canManageObjectResponsibles(params.roleCodes) || hasDelegatedObjectAction(params.currentUserId, params.objectId, 'assign', false);
  const canEdit =
    canEditObject(params.roleCodes) ||
    (params.objectStatus === 'frozen' &&
      canOverrideFrozenObject(params.roleCodes)) || hasDelegatedObjectAction(params.currentUserId, params.objectId, 'edit', false);
  const hasOwnOperationalScope =
    hasWideObjectAccess(params.roleCodes) ||
    params.createdByUserId === params.currentUserId ||
    params.assignments.some(
      (assignment) => assignment.userId === params.currentUserId,
    );
  const hasOperationalScope = hasOwnOperationalScope || hasDelegatedObjectAction(params.currentUserId, params.objectId, 'view', false);
  const isAssignedObjectManager = params.assignments.some(
    (assignment) => assignment.userId === params.currentUserId && assignment.roleCode === 'manager',
  );

  return {
    canEdit,
    canEditDailyRate: canEdit && canOverrideObjectAttendanceRate(params.roleCodes),
    canViewCompensationRates: canEditObjectDailyRate(params.roleCodes) || hasOperationalScope,
    canManageCompensationRates: canEditObjectDailyRate(params.roleCodes),
    canChangeStatus: canManageResponsibles,
    canManageResponsibles,
    canManageManagers: canManageResponsibles,
    canCreateTask:
      hasOperationalScope,
    canViewBasicProfile:
      hasOperationalScope || hasHrObjectView(params.permissionCodes),
    canViewOperationalSections: hasOperationalScope,
    canViewReportsHistory: hasOperationalScope || params.permissionCodes.includes('objects.hr_reports_view'),
    canManageEmployees: canManageEmployeeAssignments(params.permissionCodes),
    canViewEmployees: hasOwnOperationalScope || hasHrObjectView(params.permissionCodes),
    canOperateAttendance: hasOwnOperationalScope,
    canAddExtraShift: isAssignedObjectManager,
  };
}
