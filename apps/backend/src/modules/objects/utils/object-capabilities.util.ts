import {
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectResponsibles,
  canOverrideFrozenObject,
  hasWideObjectAccess,
} from './object-access.util';
import { canManageEmployeeAssignments } from '../../employees/utils/employee-hr-access.util';

interface ObjectCapabilityAssignment {
  userId: string;
  roleCode: string;
}

export function buildObjectCapabilities(params: {
  currentUserId: string;
  roleCodes: string[];
  permissionCodes: string[];
  objectStatus: string;
  createdByUserId: string;
  assignments: ObjectCapabilityAssignment[];
}): {
  canEdit: boolean;
  canEditDailyRate: boolean;
  canChangeStatus: boolean;
  canManageResponsibles: boolean;
  canManageManagers: boolean;
  canCreateTask: boolean;
  canViewOperationalSections: boolean;
  canManageEmployees: boolean;
} {
  const canManageResponsibles = canManageObjectResponsibles(params.roleCodes);
  const canEdit =
    canEditObject(params.roleCodes) ||
    (params.objectStatus === 'frozen' &&
      canOverrideFrozenObject(params.roleCodes));
  const hasOperationalScope =
    hasWideObjectAccess(params.roleCodes) ||
    params.createdByUserId === params.currentUserId ||
    params.assignments.some(
      (assignment) => assignment.userId === params.currentUserId,
    );

  return {
    canEdit,
    canEditDailyRate: canEdit && canEditObjectDailyRate(params.roleCodes),
    canChangeStatus: canManageResponsibles,
    canManageResponsibles,
    canManageManagers: canManageResponsibles,
    canCreateTask:
      hasOperationalScope,
    canViewOperationalSections: hasOperationalScope,
    canManageEmployees: canManageEmployeeAssignments(params.permissionCodes),
  };
}
