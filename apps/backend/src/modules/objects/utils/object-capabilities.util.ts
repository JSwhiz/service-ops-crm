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
import { hasDelegatedObjectAction, ObjectDelegatedAction } from '../../user-substitutions/object-delegation.context';
import { AccessSubject, decideAccess } from '../../users-access/utils/access-policy.util';

interface ObjectCapabilityAssignment {
  userId: string;
  roleCode: string;
}

export function buildObjectCapabilities(params: {
  subject?: AccessSubject;
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
  canReadMaterials: boolean;
  canManageMaterials: boolean;
  canReadContacts: boolean;
  canManageContacts: boolean;
  canChangeStatus: boolean;
  canFreeze: boolean;
  canArchive: boolean;
  canRestore: boolean;
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
  const context = { resourceType: 'object', resourceId: params.objectId, ownerUserId: params.createdByUserId,
    assignedUserIds: params.assignments.map(a => a.userId) };
  const delegated = (coarse: ObjectDelegatedAction, leaf: string) => hasDelegatedObjectAction(params.currentUserId, params.objectId, coarse, false, leaf, context);
  const ownManagement = canManageObjectResponsibles(params.roleCodes);
  const canManageResponsibles = ownManagement || delegated('assign', 'objects.responsibles.manage');
  const canEdit =
    canEditObject(params.roleCodes) ||
    (params.objectStatus === 'frozen' &&
      canOverrideFrozenObject(params.roleCodes)) || delegated('edit', 'objects.update');
  const hasOwnOperationalScope =
    hasWideObjectAccess(params.roleCodes) ||
    params.createdByUserId === params.currentUserId ||
    params.assignments.some(
      (assignment) => assignment.userId === params.currentUserId,
    );
  const hasOperationalScope = hasOwnOperationalScope || delegated('view', 'objects.read');
  const isAssignedObjectManager = params.assignments.some(
    (assignment) => assignment.userId === params.currentUserId && assignment.roleCode === 'manager',
  );
  const hrView = decideAccess(params.subject ?? { id: params.currentUserId }, 'objects.view_hr', hasHrObjectView(params.permissionCodes), {
    resourceType: 'object', resourceId: params.objectId, ownerUserId: params.createdByUserId, assignedUserIds: params.assignments.map(a => a.userId),
  });

  const legacy = {
    canEdit,
    canEditDailyRate: canEdit && canOverrideObjectAttendanceRate(params.roleCodes),
    canViewCompensationRates: canEditObjectDailyRate(params.roleCodes) || hasOwnOperationalScope || delegated('view', 'objects.rates.read'),
    canManageCompensationRates: canEditObjectDailyRate(params.roleCodes),
    canReadMaterials: true,
    canManageMaterials: canEditObject(params.roleCodes) ||
      (params.objectStatus === 'frozen' && canOverrideFrozenObject(params.roleCodes)) ||
      delegated('edit', 'objects.materials.manage'),
    canReadContacts: true,
    canManageContacts: canEdit,
    canChangeStatus: ownManagement || delegated('status', 'objects.status'),
    canFreeze: ownManagement || delegated('status', 'objects.freeze'),
    canArchive: ownManagement || delegated('status', 'objects.archive'),
    canRestore: ownManagement || delegated('status', 'objects.restore'),
    canManageResponsibles,
    canManageManagers: ownManagement || delegated('assign', 'objects.managers.manage'),
    canCreateTask:
      hasOperationalScope,
    canViewBasicProfile:
      hasOperationalScope || hrView,
    canViewOperationalSections: hasOperationalScope,
    canViewReportsHistory: hasOwnOperationalScope || delegated('view', 'objects.reports.read') || decideAccess(params.subject ?? { id: params.currentUserId }, 'objects.hr_reports_view', params.permissionCodes.includes('objects.hr_reports_view'), {
      resourceType: 'object', resourceId: params.objectId, ownerUserId: params.createdByUserId, assignedUserIds: params.assignments.map(a => a.userId),
    }),
    canManageEmployees: canManageEmployeeAssignments(params.permissionCodes),
    canViewEmployees: hasOwnOperationalScope || hrView,
    canOperateAttendance: hasOwnOperationalScope,
    canAddExtraShift: isAssignedObjectManager,
  };
  const subject = params.subject ?? { id: params.currentUserId, roleCodes: params.roleCodes, permissionCodes: params.permissionCodes };
  const mapping: Partial<Record<keyof typeof legacy, string>> = {
    canEdit: 'objects.update', canEditDailyRate: 'objects.rates.manage', canViewCompensationRates: 'objects.rates.read',
    canManageCompensationRates: 'objects.rates.manage', canChangeStatus: 'objects.status', canManageResponsibles: 'objects.responsibles.manage',
    canReadMaterials: 'objects.materials.read', canManageMaterials: 'objects.materials.manage',
    canReadContacts: 'objects.contacts.read', canManageContacts: 'objects.contacts.manage',
    canFreeze: 'objects.freeze', canArchive: 'objects.archive', canRestore: 'objects.restore',
    canManageManagers: 'objects.managers.manage', canViewBasicProfile: 'objects.read', canViewOperationalSections: 'objects.read',
    canViewReportsHistory: 'objects.reports.read', canManageEmployees: 'objects.staffing.manage', canViewEmployees: 'objects.staffing.read',
    canOperateAttendance: 'objects.attendance.edit', canAddExtraShift: 'objects.compensation.adjust',
  };
  for (const [key, action] of Object.entries(mapping)) {
    const capability = key as keyof typeof legacy;
    legacy[capability] = decideAccess(subject, action, legacy[capability], context);
  }
  legacy.canCreateTask = legacy.canCreateTask && decideAccess(subject, 'objects.read', true, context);
  legacy.canRestore &&= params.objectStatus === 'archived';
  legacy.canFreeze &&= params.objectStatus !== 'frozen' && (params.objectStatus !== 'archived' || legacy.canRestore);
  legacy.canArchive &&= params.objectStatus !== 'archived';
  legacy.canManageContacts &&= params.objectStatus !== 'archived' &&
    (params.objectStatus !== 'frozen' || canOverrideFrozenObject(params.roleCodes));
  legacy.canManageMaterials &&= params.objectStatus !== 'archived' &&
    (params.objectStatus !== 'frozen' || canOverrideFrozenObject(params.roleCodes));
  return legacy;
}
