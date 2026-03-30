export function hasWideTaskAccess(roleCodes: string[]): boolean {
  return roleCodes.includes('founder') || roleCodes.includes('director');
}
