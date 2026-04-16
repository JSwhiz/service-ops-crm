export const WIDE_TIMESHEET_ACCESS_ROLES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

export const TIMESHEET_MANUAL_CORRECTION_ROLES = [
  'founder',
  'director',
] as const;

export function hasWideTimesheetAccess(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    WIDE_TIMESHEET_ACCESS_ROLES.includes(
      role as (typeof WIDE_TIMESHEET_ACCESS_ROLES)[number],
    ),
  );
}

export function canManuallyCorrectTimesheet(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    TIMESHEET_MANUAL_CORRECTION_ROLES.includes(
      role as (typeof TIMESHEET_MANUAL_CORRECTION_ROLES)[number],
    ),
  );
}
