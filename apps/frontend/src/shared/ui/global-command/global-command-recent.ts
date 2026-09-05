import type { CommandItem } from './global-command-registry';

const RECENT_KEY_PREFIX = 'service-ops-command-recent-v2';
export const MAX_RECENT_ITEMS = 8;

export interface StoredRecentItem {
  id: string;
  label: string;
  description?: string;
  href: string;
  kind: 'entity';
}

function storageKey(userId: string): string {
  return `${RECENT_KEY_PREFIX}:${userId}`;
}

export function readRecentItems(userId: string | undefined): StoredRecentItem[] {
  if (typeof window === 'undefined' || !userId) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? (parsed.slice(0, MAX_RECENT_ITEMS) as StoredRecentItem[])
      : [];
  } catch {
    return [];
  }
}

export function recordRecentEntity(
  userId: string | undefined,
  item: Pick<CommandItem, 'id' | 'label' | 'description' | 'href'>,
): void {
  if (typeof window === 'undefined' || !userId) return;

  const current = readRecentItems(userId).filter((entry) => entry.href !== item.href);
  const next: StoredRecentItem[] = [
    {
      id: item.id,
      label: item.label,
      description: item.description,
      href: item.href,
      kind: 'entity',
    },
    ...current,
  ].slice(0, MAX_RECENT_ITEMS);

  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
}

export function recordRecentCommand(
  userId: string | undefined,
  item: CommandItem,
): void {
  if (item.kind !== 'entity') return;
  recordRecentEntity(userId, item);
}
