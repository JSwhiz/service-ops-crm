export function hasWideTimesheetAccess(roleCodes: string[]): boolean {
  return roleCodes.includes('founder') || roleCodes.includes('director');
}
