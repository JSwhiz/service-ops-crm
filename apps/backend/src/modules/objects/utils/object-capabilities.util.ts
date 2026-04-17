import { canCreateTaskOnObject } from '../../tasks/utils/task-access.util';

import {
  canEditObject,
  canEditObjectDailyRate,
  canManageObjectResponsibles,
  canOverrideFrozenObject,
} from './object-access.util';

interface ObjectCapabilityAssignment {
  userId: string;
  roleCode: string;
}

export function buildObjectCapabilities(params: {
  currentUserId: string;
  roleCodes: string[];
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
} {
  const canManageResponsibles = canManageObjectResponsibles(params.roleCodes);
  const canEdit =
    canEditObject(params.roleCodes) ||
    (params.objectStatus === 'frozen' &&
      canOverrideFrozenObject(params.roleCodes));

  return {
    canEdit,
    canEditDailyRate: canEdit && canEditObjectDailyRate(params.roleCodes),
    canChangeStatus: canManageResponsibles,
    canManageResponsibles,
    canManageManagers: canManageResponsibles,
    canCreateTask: canCreateTaskOnObject({
      currentUserId: params.currentUserId,
      roleCodes: params.roleCodes,
      object: {
        createdByUserId: params.createdByUserId,
        assignments: params.assignments.map((assignment) => ({
          userId: assignment.userId,
          assignmentRoleCode: assignment.roleCode,
        })),
      },
    }),
  };
}
