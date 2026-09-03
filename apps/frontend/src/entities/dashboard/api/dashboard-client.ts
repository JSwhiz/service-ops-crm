import { fetcher } from '@/shared/api/fetcher';

import type { LeadershipDashboardResponse } from '../model/dashboard.types';

export async function getLeadershipDashboard(): Promise<LeadershipDashboardResponse> {
  return fetcher<LeadershipDashboardResponse>('/dashboard/leadership', {
    method: 'GET',
  });
}
