export const WIDE_TIMESHEET_ACCESS_ROLES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
] as const;

export function hasWideTimesheetAccess(roleCodes: string[]): boolean {
  return roleCodes.some((role) =>
    WIDE_TIMESHEET_ACCESS_ROLES.includes(
      role as (typeof WIDE_TIMESHEET_ACCESS_ROLES)[number],
    ),
  );
}
