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
  'deputy_founder',
  'director',
] as const;

export const FROZEN_OBJECT_OVERRIDE_ROLES = [
  'founder',
  'director',
] as const;

export function hasWideObjectAccess(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    WIDE_OBJECT_ACCESS_ROLES.includes(
      role as (typeof WIDE_OBJECT_ACCESS_ROLES)[number],
    ),
  );
}

export function canCreateObject(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    OBJECT_CREATE_ROLES.includes(
      role as (typeof OBJECT_CREATE_ROLES)[number],
    ),
  );
}

export function canEditObject(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    OBJECT_EDIT_ROLES.includes(role as (typeof OBJECT_EDIT_ROLES)[number]),
  );
}

export function canEditObjectDailyRate(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    OBJECT_DAILY_RATE_EDIT_ROLES.includes(
      role as (typeof OBJECT_DAILY_RATE_EDIT_ROLES)[number],
    ),
  );
}

export function canOverrideFrozenObject(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    FROZEN_OBJECT_OVERRIDE_ROLES.includes(
      role as (typeof FROZEN_OBJECT_OVERRIDE_ROLES)[number],
    ),
  );
}
