export const WIDE_OBJECT_ACCESS_ROLES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_CREATE_ROLES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_EDIT_ROLES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_DAILY_RATE_EDIT_ROLES = [
  'founder',
  'director',
] as const;

export const FROZEN_OBJECT_OVERRIDE_ROLES = [
  'founder',
  'director',
  'deputy_founder',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_RESPONSIBLE_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_MANAGER_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

function includesRole<T extends readonly string[]>(
  allowed: T,
  role: string,
): boolean {
  return allowed.includes(role as T[number]);
}

export function hasWideObjectAccess(roleCodes: string[]): boolean {
  return roleCodes.some((role) => includesRole(WIDE_OBJECT_ACCESS_ROLES, role));
}

export function canCreateObject(roleCodes: string[]): boolean {
  return roleCodes.some((role) => includesRole(OBJECT_CREATE_ROLES, role));
}

export function canEditObject(roleCodes: string[]): boolean {
  return roleCodes.some((role) => includesRole(OBJECT_EDIT_ROLES, role));
}

export function canEditObjectDailyRate(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    includesRole(OBJECT_DAILY_RATE_EDIT_ROLES, role),
  );
}

export function canOverrideFrozenObject(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    includesRole(FROZEN_OBJECT_OVERRIDE_ROLES, role),
  );
}

export function isLeadershipRole(roleCode: string): boolean {
  return includesRole(OBJECT_RESPONSIBLE_ROLE_CODES, roleCode);
}

export function canAssignObjectResponsible(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    includesRole(OBJECT_RESPONSIBLE_ROLE_CODES, role),
  );
}

export function canManageObjectManagers(roleCodes: string[]): boolean {
  return canAssignObjectResponsible(roleCodes);
}

export function canBeObjectResponsible(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    includesRole(OBJECT_RESPONSIBLE_ROLE_CODES, role),
  );
}

export function canBeObjectManager(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    includesRole(OBJECT_MANAGER_ROLE_CODES, role),
  );
}
