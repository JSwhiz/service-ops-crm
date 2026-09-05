'use client';

import { useEffect } from 'react';

import { useAuth } from '@/shared/auth/use-auth';

import { recordRecentEntity } from './global-command-recent';

interface RecentEntityInput {
  id: string;
  label: string;
  description?: string;
  href: string;
}

export function useRecordRecentEntity(item: RecentEntityInput | null | undefined): void {
  const { user } = useAuth();
  const id = item?.id;
  const label = item?.label;
  const description = item?.description;
  const href = item?.href;

  useEffect(() => {
    if (!id || !label || !href) return;
    recordRecentEntity(user?.id, { id, label, description, href });
  }, [description, href, id, label, user?.id]);
}
