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

export function canCreateEmployee(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.create);
}

export function canEditEmployee(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.edit);
}

export function canArchiveEmployee(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.archive);
}

export function canRestoreEmployee(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, EMPLOYEE_PERMISSION_CODES.restore);
}

export function canDeleteEmployeePermanently(
  permissionCodes: string[],
): boolean {
  return hasPermission(
    permissionCodes,
    EMPLOYEE_PERMISSION_CODES.deletePermanently,
  );
}

export function canManageEmployeeAssignments(
  permissionCodes: string[],
): boolean {
  return hasPermission(
    permissionCodes,
    EMPLOYEE_PERMISSION_CODES.manageAssignments,
  );
}

export function canDeleteEmployeeAssignmentAsError(
  permissionCodes: string[],
): boolean {
  return hasPermission(
    permissionCodes,
    EMPLOYEE_PERMISSION_CODES.deleteAssignmentAsError,
  );
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
    canCreateEmployee: canCreateEmployee(permissionCodes),
    canEditEmployee: canEditEmployee(permissionCodes),
    canArchiveEmployee: canArchiveEmployee(permissionCodes),
    canRestoreEmployee: canRestoreEmployee(permissionCodes),
    canDeleteEmployeePermanently:
      canDeleteEmployeePermanently(permissionCodes),
    canManageEmployeeAssignments:
      canManageEmployeeAssignments(permissionCodes),
    canDeleteEmployeeAssignmentAsError:
      canDeleteEmployeeAssignmentAsError(permissionCodes),
  };
}
