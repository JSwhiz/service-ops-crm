'use client';

import React from 'react';

import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { EmptyState, Surface } from '@/shared/ui/foundation';

import { pickDashboardRoute } from '../model/dashboard-route';

import { DashboardWorkspace } from './dashboard-workspace';
import { HrDashboard } from './hr-dashboard';
import { LeadershipDashboard } from './leadership-dashboard';
import { ManagerDashboard } from './manager-dashboard';
import { OperationManagerDashboard } from './operation-manager-dashboard';

export function DashboardRoleRouter(): React.JSX.Element | null {
  const { user } = useAuth();
  const accessRevision = useAccessRevision();
  useOpenAccessRefresh(Boolean(user));

  if (!user) return null;

  // Dashboard reads/previews contain no create draft to preserve: a new access
  // revision must unmount stale variant data even when its booleans stay true.
  switch (pickDashboardRoute(user)) {
    case 'leadership': return <LeadershipDashboard key={accessRevision} />;
    case 'hr': return <HrDashboard key={accessRevision} />;
    case 'manager': return <ManagerDashboard key={accessRevision} />;
    case 'operations': return <OperationManagerDashboard key={accessRevision} />;
    case 'workspace': return <DashboardWorkspace key={accessRevision} />;
    case 'blocked': return <Surface padding="md"><EmptyState title="Рабочий стол недоступен" description="У вас нет доступа к рабочему столу." /></Surface>;
  }
}
