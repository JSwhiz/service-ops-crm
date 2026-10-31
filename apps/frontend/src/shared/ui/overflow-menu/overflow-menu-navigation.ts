export function getMenuBoundaryIndex(enabledIndexes: readonly number[], last: boolean): number | null {
  if (enabledIndexes.length === 0) return null;
  return last ? enabledIndexes[enabledIndexes.length - 1] ?? null : enabledIndexes[0] ?? null;
}
