export function hasWideObjectAccess(roleCodes: string[]): boolean {
  return roleCodes.includes('founder') || roleCodes.includes('director');
}
