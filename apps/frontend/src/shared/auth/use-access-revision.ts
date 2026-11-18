'use client';

import { useAuth } from './use-auth';

/** Reload reads, not component keys: open forms keep their local drafts. */
export function useAccessRevision(): string {
  const { user } = useAuth();
  return user ? `${user.id}:${user.accessVersion ?? 'legacy'}` : 'signed-out';
}
