'use client';

import React from 'react';

import { useAuth } from '@/shared/auth/use-auth';

import { DashboardWorkspace } from './dashboard-workspace';
import { HrDashboard } from './hr-dashboard';
import { LeadershipDashboard } from './leadership-dashboard';
import { ManagerDashboard } from './manager-dashboard';

const LEADERSHIP_ROLE_CODES = new Set([
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
  'deputy_director',
]);
const MANAGER_ROLE_CODES = new Set([
  'manager',
  'senior_manager',
  'operation_manager',
]);

export function DashboardRoleRouter(): React.JSX.Element | null {
  const { user } = useAuth();

  if (!user) return null;

  const roleCodes = user.roleCodes?.length ? user.roleCodes : [user.roleCode];
  if (roleCodes.some((roleCode) => LEADERSHIP_ROLE_CODES.has(roleCode))) {
    return <LeadershipDashboard />;
  }
  if (roleCodes.includes('hr')) {
    return <HrDashboard />;
  }
  if (roleCodes.some((roleCode) => MANAGER_ROLE_CODES.has(roleCode))) {
    return <ManagerDashboard />;
  }
  return <DashboardWorkspace />;
}
