import type { CommandItem } from './global-command-registry';

const RECENT_KEY_PREFIX = 'service-ops-command-recent-v3';
export const MAX_RECENT_ITEMS = 8;

export type RecentEntityType =
  | 'object'
  | 'one_time_order'
  | 'task'
  | 'employee'
  | 'candidate';

export interface StoredRecentRef {
  type: RecentEntityType;
  id: string;
}

const ENTITY_ROUTES: Array<{
  type: RecentEntityType;
  pattern: RegExp;
}> = [
  { type: 'object', pattern: /^\/objects\/([0-9a-f-]{36})(?:\/|$)/i },
  { type: 'one_time_order', pattern: /^\/one-time-orders\/([0-9a-f-]{36})(?:\/|$)/i },
  { type: 'task', pattern: /^\/tasks\/([0-9a-f-]{36})(?:\/|$)/i },
  { type: 'employee', pattern: /^\/employees\/([0-9a-f-]{36})(?:\/|$)/i },
  { type: 'candidate', pattern: /^\/candidates\/([0-9a-f-]{36})(?:\/|$)/i },
];

function storageKey(userId: string): string {
  return `${RECENT_KEY_PREFIX}:${userId}`;
}

export function parseRecentEntityPath(pathname: string): StoredRecentRef | null {
  for (const route of ENTITY_ROUTES) {
    const match = pathname.match(route.pattern);
    if (match?.[1]) return { type: route.type, id: match[1] };
  }
  return null;
}

export function readRecentRefs(userId: string | undefined): StoredRecentRef[] {
  if (typeof window === 'undefined' || !userId) return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredRecentRef =>
        Boolean(
          item &&
          typeof item === 'object' &&
          'type' in item &&
          'id' in item &&
          typeof item.type === 'string' &&
          typeof item.id === 'string',
        ),
      )
      .slice(0, MAX_RECENT_ITEMS);
  } catch {
    return [];
  }
}

export function recordRecentRef(
  userId: string | undefined,
  ref: StoredRecentRef | null | undefined,
): void {
  if (typeof window === 'undefined' || !userId || !ref) return;

  const current = readRecentRefs(userId).filter(
    (entry) => entry.type !== ref.type || entry.id !== ref.id,
  );
  const next = [ref, ...current].slice(0, MAX_RECENT_ITEMS);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
}

export function recordRecentPath(
  userId: string | undefined,
  pathname: string,
): void {
  recordRecentRef(userId, parseRecentEntityPath(pathname));
}

export function recordRecentCommand(
  userId: string | undefined,
  item: CommandItem,
): void {
  if (item.kind !== 'entity') return;
  recordRecentPath(userId, item.href);
}
