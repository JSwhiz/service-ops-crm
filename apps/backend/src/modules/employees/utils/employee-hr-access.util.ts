const EMPLOYEE_HR_VIEW_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
  'hr',
] as const;

const EMPLOYEE_HR_MANAGE_ROLE_CODES = EMPLOYEE_HR_VIEW_ROLE_CODES;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

export function canViewEmployeesHr(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, EMPLOYEE_HR_VIEW_ROLE_CODES);
}

export function canManageEmployeesHr(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, EMPLOYEE_HR_MANAGE_ROLE_CODES);
}
