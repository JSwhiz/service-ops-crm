export const EMPLOYEE_PERMISSION_CODES = {
  view: "employees.view",
  create: "employees.create",
  edit: "employees.edit",
  archive: "employees.archive",
  restore: "employees.restore",
  deletePermanently: "employees.delete_permanently",
  manageAssignments: "employees.assignments.manage",
  deleteAssignmentAsError: "employees.assignments.delete_error",
} as const;

function hasPermission(
  permissionCodes: string[],
  permissionCode: string,
): boolean {
  return permissionCodes.includes(permissionCode);
}

export function canViewEmployeesHr(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.view);
}

export function canManageEmployeesHr(permissionCodes: string[]): boolean {
  return (
    hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.create) ||
    hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.edit)
  );
}

export function buildEmployeeGlobalCapabilities(permissionCodes: string[]) {
  return {
    canAccessEmployeesHr: canViewEmployeesHr(permissionCodes),
    canCreateEmployee: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.create,
    ),
    canEditEmployee: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.edit,
    ),
    canArchiveEmployee: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.archive,
    ),
    canRestoreEmployee: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.restore,
    ),
    canDeleteEmployeePermanently: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.deletePermanently,
    ),
    canManageEmployeeAssignments: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.manageAssignments,
    ),
    canDeleteEmployeeAssignmentAsError: hasPermission(
      permissionCodes,
      EMPLOYEE_PERMISSION_CODES.deleteAssignmentAsError,
    ),
  };
}
