import type { AuthUser } from '@/shared/auth/auth-client';

export type DashboardRoute = 'blocked' | 'leadership' | 'hr' | 'manager' | 'operations' | 'workspace';

const LEADERSHIP_ROLE_CODES = new Set(['founder', 'deputy_founder', 'director', 'corporate_director', 'deputy_director']);
const MANAGER_ROLE_CODES = new Set(['manager', 'senior_manager', 'operation_manager']);

/** Roles express preference only; the server capabilities authorize each variant. */
export function pickDashboardRoute(user: Pick<AuthUser, 'roleCode' | 'roleCodes' | 'capabilities'> | null): DashboardRoute {
  const capabilities = user?.capabilities;
  if (capabilities?.canAccessDashboard !== true) return 'blocked';
  const roles = user?.roleCodes?.length ? user.roleCodes : [user?.roleCode];
  if (roles.some((role) => role !== undefined && LEADERSHIP_ROLE_CODES.has(role)) && capabilities.canViewLeadershipDashboard === true) return 'leadership';
  if (roles.includes('hr') && capabilities.canViewHrDashboard === true) return 'hr';
  // operation_manager keeps the existing assignment-driven manager preference.
  if (roles.some((role) => role !== undefined && MANAGER_ROLE_CODES.has(role)) && capabilities.canViewManagerDashboard === true) return 'manager';
  if (capabilities.canViewLeadershipDashboard === true) return 'leadership';
  if (capabilities.canViewHrDashboard === true) return 'hr';
  if (capabilities.canViewManagerDashboard === true) return 'manager';
  if (capabilities.canViewOperationsDashboard === true) return 'operations';
  return 'workspace';
}
