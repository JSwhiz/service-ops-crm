export function hasAnyRole(
  roleCodes: string[] | undefined,
  requiredRoles: string[],
): boolean {
  if (!roleCodes || roleCodes.length === 0) {
    return false;
  }

  return requiredRoles.some((role) => roleCodes.includes(role));
}

export function canCreateObject(roleCodes: string[] | undefined): boolean {
  return hasAnyRole(roleCodes, [
    'founder',
    'deputy_founder',
    'director',
    'deputy_director',
  ]);
}
