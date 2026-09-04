import { fetcher } from '@/shared/api/fetcher';

import type {
  HrDashboardResponse,
  LeadershipDashboardResponse,
  ManagerDashboardResponse,
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

export async function getManagerDashboard(): Promise<ManagerDashboardResponse> {
  return fetcher<ManagerDashboardResponse>('/dashboard/manager', {
    method: 'GET',
  });
}

export async function getHrDashboard(): Promise<HrDashboardResponse> {
  return fetcher<HrDashboardResponse>('/dashboard/hr', {
    method: 'GET',
  });
}

export async function getOperationManagerDashboard(): Promise<OperationManagerDashboardResponse> {
  return fetcher<OperationManagerDashboardResponse>('/dashboard/operation-manager', {
    method: 'GET',
  });
}
