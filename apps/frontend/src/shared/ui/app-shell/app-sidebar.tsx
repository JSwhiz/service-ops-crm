'use client';

import Link from 'next/link';
import React from 'react';

import { useAuth } from '@/shared/auth/use-auth';
import { NavLink } from '@/shared/ui/nav-link/nav-link';

interface AppSidebarProps {
  expanded: boolean;
  onToggle: () => void;
}

type IconName =
  | 'workspace'
  | 'approvals'
  | 'objects'
  | 'orders'
  | 'accountability'
  | 'inventory'
  | 'equipment'
  | 'tasks'
  | 'timesheet'
  | 'candidates'
  | 'employees'
  | 'settings';

function Icon({ name }: { name: IconName }): React.JSX.Element {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'workspace':
      return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
    case 'approvals':
      return <svg viewBox="0 0 24 24" {...common}><path d="M8 4h8"/><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="m8.5 13 2.2 2.2 4.8-5"/></svg>;
    case 'objects':
      return <svg viewBox="0 0 24 24" {...common}><path d="M4 20V7l8-4 8 4v13"/><path d="M8 20v-5h8v5M8 9h.01M12 9h.01M16 9h.01M8 12h.01M12 12h.01M16 12h.01"/></svg>;
    case 'orders':
      return <svg viewBox="0 0 24 24" {...common}><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h3"/></svg>;
    case 'accountability':
      return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M7 6V4h10v2"/></svg>;
    case 'inventory':
      return <svg viewBox="0 0 24 24" {...common}><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/></svg>;
    case 'equipment':
      return <svg viewBox="0 0 24 24" {...common}><path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.6 2.6-3-3 2.6-2.6Z"/></svg>;
    case 'tasks':
      return <svg viewBox="0 0 24 24" {...common}><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3.5 5 1 1 2-2M3.5 12l1 1 2-2M3.5 19l1 1 2-2"/></svg>;
    case 'timesheet':
      return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 18h2M14 18h2"/></svg>;
    case 'candidates':
      return <svg viewBox="0 0 24 24" {...common}><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M17 8v6M14 11h6"/></svg>;
    case 'employees':
      return <svg viewBox="0 0 24 24" {...common}><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M13 20a4.5 4.5 0 0 1 9 0"/></svg>;
    case 'settings':
      return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1v-.1h4v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/></svg>;
  }
}

function ToggleIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={expanded ? 'm14.5 7-5 5 5 5' : 'm9.5 7 5 5-5 5'} />
    </svg>
  );
}

export function AppSidebar({ expanded, onToggle }: AppSidebarProps): React.JSX.Element {
  const { user } = useAuth();
  const canAccessApprovals = user?.capabilities?.canAccessApprovals ?? false;
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;
  const canAccessOneTimeOrders = user?.capabilities?.canAccessOneTimeOrders ?? false;
  const canViewOneTimeOrderReviews = user?.capabilities?.canViewAllOneTimeOrderReviews ?? false;
  const canAccessAccountability = user?.capabilities?.canAccessAccountability ?? false;
  const canAccessInventory = user?.capabilities?.canAccessInventory ?? false;
  const canAccessEquipment = user?.capabilities?.canAccessEquipment ?? false;
  const canAccessCandidates = user?.capabilities?.canAccessCandidates ?? false;

  return (
    <aside className="app-sidebar" aria-label="Основная навигация">
      <div className="app-sidebar__brand-row">
        <Link className="app-sidebar__brand" href="/dashboard" aria-label="Рабочий стол">
          <span className="app-sidebar__brand-mark" aria-hidden="true">SO</span>
          <span className="app-sidebar__brand-copy">
            <span className="app-sidebar__brand-name">Service Ops</span>
            <span className="app-sidebar__brand-subtitle">Workspace</span>
          </span>
        </Link>
        <button
          type="button"
          className="app-sidebar__toggle"
          onClick={onToggle}
          aria-label={expanded ? 'Свернуть боковую панель' : 'Развернуть боковую панель'}
          aria-pressed={expanded}
        >
          <ToggleIcon expanded={expanded} />
        </button>
      </div>

      <nav className="app-sidebar__nav">
        <div className="app-sidebar__nav-main">
          <NavLink href="/dashboard" label="Рабочий стол" icon={<Icon name="workspace" />} />
          {canAccessApprovals ? <NavLink href="/approvals" label="Согласования" icon={<Icon name="approvals" />} /> : null}
          <NavLink href="/objects" label="Объекты" icon={<Icon name="objects" />} />
          {canAccessOneTimeOrders || canViewOneTimeOrderReviews ? (
            <NavLink href="/one-time-orders" label="Разовые заказы" icon={<Icon name="orders" />} />
          ) : null}
          {canAccessAccountability ? <NavLink href="/accountability" label="Подотчет" icon={<Icon name="accountability" />} /> : null}
          {canAccessInventory ? <NavLink href="/inventory" label="Расходники" icon={<Icon name="inventory" />} /> : null}
          {canAccessEquipment ? <NavLink href="/equipment" label="Оборудование" icon={<Icon name="equipment" />} /> : null}
          <NavLink href="/tasks" label="Задачи" icon={<Icon name="tasks" />} />
          <NavLink href="/timesheet" label="Табель" icon={<Icon name="timesheet" />} />
          {canAccessCandidates ? <NavLink href="/candidates" label="Кандидаты" icon={<Icon name="candidates" />} /> : null}
          {canAccessEmployeesHr ? <NavLink href="/employees" label="Сотрудники" icon={<Icon name="employees" />} /> : null}
        </div>

        <div className="app-sidebar__nav-bottom">
          <NavLink href="/settings" label="Настройки" icon={<Icon name="settings" />} />
        </div>
      </nav>
    </aside>
  );
}
