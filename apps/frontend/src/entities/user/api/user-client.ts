import { fetcher } from '@/shared/api/fetcher';

import type { SystemUserOption } from '../model/user.types';

export type { SystemUserOption } from '../model/user.types';

export async function listSystemUsers(): Promise<SystemUserOption[]> {
  return fetcher<SystemUserOption[]>('/users-access/users', {
    method: 'GET',
  });
}
