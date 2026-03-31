import React from 'react';

import { NavLink } from '@/shared/ui/nav-link/nav-link';

export function AppSidebar(): React.JSX.Element {
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__title">Service Ops CRM</div>

      <nav className="app-sidebar__nav">
        <NavLink href="/dashboard" label="Рабочий стол" />
        <NavLink href="/objects" label="Объекты" />
        <NavLink href="/tasks" label="Задачи" />
        <NavLink href="/timesheet" label="Табель" />
        <NavLink href="/settings" label="Настройки" />
      </nav>
    </aside>
  );
}
