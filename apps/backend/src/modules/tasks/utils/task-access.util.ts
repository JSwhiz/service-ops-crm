export const TASK_LEADERSHIP_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
] as const;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode as never));
}

export function hasWideTaskAccess(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, TASK_LEADERSHIP_ROLE_CODES);
}
