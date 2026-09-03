import { fetcher } from '@/shared/api/fetcher';

import type {
  LeadershipDashboardResponse,
  OperationManagerDashboardResponse,
} from '../model/dashboard.types';

export async function getLeadershipDashboard(
  expanded = false,
): Promise<LeadershipDashboardResponse> {
  const suffix = expanded ? '?expanded=true' : '';
  return fetcher<LeadershipDashboardResponse>(`/dashboard/leadership${suffix}`, {
    method: 'GET',
  });
}

export async function getOperationManagerDashboard(): Promise<OperationManagerDashboardResponse> {
  return fetcher<OperationManagerDashboardResponse>('/dashboard/operation-manager', {
    method: 'GET',
  });
}
