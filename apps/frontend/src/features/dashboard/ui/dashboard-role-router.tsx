'use client';

import React from 'react';

import { useAuth } from '@/shared/auth/use-auth';

import { DashboardWorkspace } from './dashboard-workspace';
import { LeadershipDashboard } from './leadership-dashboard';

const LEADERSHIP_ROLE_CODES = new Set([
  'founder',
  'deputy_founder',
  'director',
  'corporate_director',
  'deputy_director',
]);

export function DashboardRoleRouter(): React.JSX.Element | null {
  const { user } = useAuth();

  if (!user) return null;

  const roleCodes = user.roleCodes?.length ? user.roleCodes : [user.roleCode];
  const isLeadership = roleCodes.some((roleCode) => LEADERSHIP_ROLE_CODES.has(roleCode));

  return isLeadership ? <LeadershipDashboard /> : <DashboardWorkspace />;
}
