'use client';

import React from 'react';

import { useAuth } from '@/shared/auth/use-auth';
import { NavLink } from '@/shared/ui/nav-link/nav-link';

export function AppSidebar(): React.JSX.Element {
  const { user } = useAuth();
  const canAccessEmployeesHr = user?.capabilities?.canAccessEmployeesHr ?? false;
  const canAccessOneTimeOrders =
    user?.capabilities?.canAccessOneTimeOrders ?? false;
  const canAccessInventory = user?.capabilities?.canAccessInventory ?? false;
  const canAccessEquipment = user?.capabilities?.canAccessEquipment ?? false;

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__title">Service Ops CRM</div>

      <nav className="app-sidebar__nav">
        <NavLink href="/dashboard" label="Рабочий стол" />
        <NavLink href="/objects" label="Объекты" />
        {canAccessOneTimeOrders ? (
          <NavLink href="/one-time-orders" label="Разовые заказы" />
        ) : null}
        {canAccessInventory ? (
          <NavLink href="/inventory" label="Расходники" />
        ) : null}
        {canAccessEquipment ? (
          <NavLink href="/equipment" label="Оборудование" />
        ) : null}
        <NavLink href="/tasks" label="Задачи" />
        <NavLink href="/timesheet" label="Табель" />
        {canAccessEmployeesHr ? (
          <NavLink href="/employees" label="Сотрудники" />
        ) : null}
        <NavLink href="/settings" label="Настройки" />
      </nav>
    </aside>
  );
}
