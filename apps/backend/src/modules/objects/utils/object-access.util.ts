export const LEADERSHIP_OBJECT_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_MANAGER_ROLE_CODES = [
  'manager',
  'senior_manager',
  'operation_manager',
  'director',
  'deputy_director',
  'corporate_director',
  'founder',
  'deputy_founder',
] as const;

export const WIDE_OBJECT_ACCESS_ROLES = LEADERSHIP_OBJECT_ROLE_CODES;

export const OBJECT_EDIT_ROLES = LEADERSHIP_OBJECT_ROLE_CODES;

export const OBJECT_DAILY_RATE_EDIT_ROLES = [
  'founder',
  'director',
] as const;

export const FROZEN_OBJECT_OVERRIDE_ROLES = [
  'founder',
  'director',
] as const;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((role) => allowed.includes(role as never));
}

export function hasWideObjectAccess(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, WIDE_OBJECT_ACCESS_ROLES);
}

export function canCreateObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES);
}

export function canEditObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_EDIT_ROLES);
}

export function canEditObjectDailyRate(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_DAILY_RATE_EDIT_ROLES);
}

export function canOverrideFrozenObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, FROZEN_OBJECT_OVERRIDE_ROLES);
}

export function canManageObjectResponsibles(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES);
}

export function canBeObjectResponsible(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, LEADERSHIP_OBJECT_ROLE_CODES);
}

export function canBeObjectManager(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_MANAGER_ROLE_CODES);
}
