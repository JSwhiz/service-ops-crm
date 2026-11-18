export type ObjectArchiveState = 'active' | 'archived';

export function parseObjectArchiveState(value: string | null, legacyStatus?: string | null): ObjectArchiveState {
  return value === 'archived' || (value === null && legacyStatus === 'archived') ? 'archived' : 'active';
}

export function objectArchiveCounts(items: ReadonlyArray<{ status: string }>): { active: number; archived: number } {
  return items.reduce((counts, item) => {
    counts[item.status === 'archived' ? 'archived' : 'active']++;
    return counts;
  }, { active: 0, archived: 0 });
}
