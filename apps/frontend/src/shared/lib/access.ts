export const LEADERSHIP_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_CREATE_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_EDIT_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const OBJECT_DAILY_RATE_EDIT_ROLE_CODES = [
  'founder',
  'director',
] as const;

export const FROZEN_OBJECT_OVERRIDE_ROLE_CODES = [
  'founder',
  'director',
] as const;

function hasAnyRole(
  roleCodes: string[],
  allowed: readonly string[],
): boolean {
  return roleCodes.some((roleCode) =>
    allowed.includes(roleCode as never),
  );
}

export function isLeadershipCircle(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, LEADERSHIP_ROLE_CODES);
}

export function canCreateObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_CREATE_ROLE_CODES);
}

export function canEditObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_EDIT_ROLE_CODES);
}

/**
 * Recovery bridge:
 * часть экранов уже использует имя canEditObjectCard.
 * Оставляем совместимость, чтобы не плодить расхождения по импортам.
 */
export function canEditObjectCard(roleCodes: string[]): boolean {
  return canEditObject(roleCodes);
}

export function canEditObjectDailyRate(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, OBJECT_DAILY_RATE_EDIT_ROLE_CODES);
}

export function canOverrideFrozenObject(roleCodes: string[]): boolean {
  return hasAnyRole(roleCodes, FROZEN_OBJECT_OVERRIDE_ROLE_CODES);
}

export function canChangeObjectStatus(roleCodes: string[]): boolean {
  return isLeadershipCircle(roleCodes);
}
