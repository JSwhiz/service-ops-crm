const OBJECT_CREATE_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

const OBJECT_EDIT_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

const OBJECT_DAILY_RATE_EDIT_ROLE_CODES = [
  'founder',
  'director',
] as const;

const FROZEN_OBJECT_OVERRIDE_ROLE_CODES = [
  'founder',
  'director',
] as const;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) => allowed.includes(roleCode));
}

export function canCreateObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_CREATE_ROLE_CODES);
}

export function canEditObjectCard(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_EDIT_ROLE_CODES);
}

export function canEditObjectDailyRate(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_DAILY_RATE_EDIT_ROLE_CODES);
}

export function canOverrideFrozenObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, FROZEN_OBJECT_OVERRIDE_ROLE_CODES);
}
