export type SavedWithoutAccess = { outcome: 'saved_without_access' };

export function isSavedWithoutAccess(result: object): result is SavedWithoutAccess {
  return 'outcome' in result && result.outcome === 'saved_without_access';
}
