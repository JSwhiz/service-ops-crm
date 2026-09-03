'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { listApprovalRequests } from '@/entities/approval/api/approval-client';
import { listEmployees } from '@/entities/employee/api/employee-client';
import { listObjects } from '@/entities/object/api/object-client';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import { listTasks } from '@/entities/task/api/task-client';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import type { EmployeeListResponse } from '@/entities/employee/model/employee.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import type { OneTimeOrderListResponse } from '@/entities/one-time-order/model/one-time-order.types';
import type { TaskListResponse } from '@/entities/task/model/task.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

type DashboardData = {
  approvals: ApprovalRequestItem[];
  overdueTasks: TaskListResponse;
  objects: ServiceObject[];
  orders: OneTimeOrderListResponse;
  employees: EmployeeListResponse;
};

const EMPTY_TASKS: TaskListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_ORDERS: OneTimeOrderListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_EMPLOYEES: EmployeeListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0, capabilities: { canCreate: false } };

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function formatDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(value));
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Активен',
    in_progress: 'В работе',
    awaiting_confirmation: 'Ждёт подтверждения',
    pending_auto_close: 'Автозакрытие',
    completed: 'Завершён',
    cancelled: 'Отменён',
    pending: 'На согласовании',
    draft: 'Черновик',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

export function DashboardWorkspace(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData>({ approvals: [], overdueTasks: EMPTY_TASKS, objects: [], orders: EMPTY_ORDERS, employees: EMPTY_EMPLOYEES });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);

    const safe = async <T,>(request: Promise<T>, fallback: T): Promise<T> => request.catch(() => fallback);

    void Promise.all([
      safe(listApprovalRequests({ status: 'pending' }), []),
      safe(listTasks({ overdue: true, page: 1, limit: 6, sortBy: 'dueAt', sortDirection: 'asc' }), EMPTY_TASKS),
      safe(listObjects(), []),
      safe(listOneTimeOrders({ page: 1, limit: 6, sortBy: 'updatedAt', sortDirection: 'desc' }), EMPTY_ORDERS),
      safe(listEmployees({ archiveState: 'active', page: 1, limit: 1 }), EMPTY_EMPLOYEES),
    ]).then(([approvals, overdueTasks, objects, orders, employees]) => {
      if (!active) return;
      setData({ approvals, overdueTasks, objects, orders, employees });
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setFailed(true);
      setLoading(false);
    });

    return () => { active = false; };
  }, []);

  const activeObjects = useMemo(() => data.objects.filter((item) => item.status === 'active').length, [data.objects]);
  const openOrders = useMemo(() => data.orders.items.filter((item) => !['completed', 'cancelled'].includes(item.status)).length, [data.orders.items]);
  const attentionTotal = data.approvals.length + data.overdueTasks.total;
  const displayName = user ? getUserDisplayName(user) : '';

  return (
    <div className="dashboard-v2">
      <section className="dashboard-v2__intro">
        <div>
          <span className="dashboard-v2__eyebrow">{greeting()}{displayName ? `, ${firstName(displayName)}` : ''}</span>
          <h1>Рабочий стол</h1>
          <p>Главное на сейчас: решения, сроки и состояние операционной работы.</p>
        </div>
        <span className={`dashboard-v2__health${attentionTotal > 0 ? ' dashboard-v2__health--attention' : ''}`}>
          <i aria-hidden="true" />
          {loading ? 'Обновляем данные' : attentionTotal > 0 ? `${attentionTotal} требуют внимания` : 'Критичных сигналов нет'}
        </span>
      </section>

      {failed ? <div className="dashboard-v2__notice">Часть данных рабочего стола временно недоступна.</div> : null}

      <section className="dashboard-v2__metrics" aria-label="Сводка">
        <Link href="/approvals" className="dashboard-v2__metric">
          <span>Согласования</span><strong>{loading ? '—' : data.approvals.length}</strong><small>ожидают решения</small>
        </Link>
        <Link href="/tasks?overdue=true" className="dashboard-v2__metric">
          <span>Просрочено задач</span><strong>{loading ? '—' : data.overdueTasks.total}</strong><small>требуют реакции</small>
        </Link>
        <Link href="/objects" className="dashboard-v2__metric">
          <span>Объекты</span><strong>{loading ? '—' : activeObjects}</strong><small>активных из {data.objects.length}</small>
        </Link>
        <Link href="/employees" className="dashboard-v2__metric">
          <span>Сотрудники</span><strong>{loading ? '—' : data.employees.total}</strong><small>в активном контуре</small>
        </Link>
      </section>

      <div className="dashboard-v2__grid">
        <section className="dashboard-v2__panel dashboard-v2__panel--attention">
          <header className="dashboard-v2__panel-head">
            <div><span className="dashboard-v2__kicker">Приоритет</span><h2>Требует внимания</h2></div>
            <Link href="/tasks">Все задачи</Link>
          </header>
          <div className="dashboard-v2__attention-list">
            {loading ? <div className="dashboard-v2__empty">Загружаем сигналы…</div> : null}
            {!loading && data.approvals.slice(0, 3).map((item) => (
              <Link href="/approvals" className="dashboard-v2__attention-row" key={`approval-${item.id}`}>
                <span className="dashboard-v2__signal dashboard-v2__signal--approval">Согласование</span>
                <span className="dashboard-v2__row-copy"><strong>{item.summary.title}</strong><small>{item.summary.subtitle ?? 'Ожидает решения'}</small></span>
                <span className="dashboard-v2__row-meta">{formatDate(item.createdAt)}</span>
              </Link>
            ))}
            {!loading && data.overdueTasks.items.slice(0, Math.max(0, 5 - Math.min(3, data.approvals.length))).map((item) => (
              <Link href={`/tasks/${item.id}`} className="dashboard-v2__attention-row" key={`task-${item.id}`}>
                <span className="dashboard-v2__signal dashboard-v2__signal--overdue">Просрочено</span>
                <span className="dashboard-v2__row-copy"><strong>{item.title}</strong><small>{item.targetName || 'Без привязки'}</small></span>
                <span className="dashboard-v2__row-meta">{formatDate(item.dueAt)}</span>
              </Link>
            ))}
            {!loading && attentionTotal === 0 ? <div className="dashboard-v2__empty dashboard-v2__empty--good"><strong>Всё спокойно</strong><span>Нет просроченных задач и ожидающих согласований.</span></div> : null}
          </div>
        </section>

        <section className="dashboard-v2__panel">
          <header className="dashboard-v2__panel-head">
            <div><span className="dashboard-v2__kicker">Операции</span><h2>Разовые заказы</h2></div>
            <Link href="/one-time-orders">Открыть</Link>
          </header>
          <div className="dashboard-v2__summary-line"><strong>{loading ? '—' : data.orders.total}</strong><span>доступно всего</span><b>{loading ? '—' : openOrders} в текущей выборке не завершены</b></div>
          <div className="dashboard-v2__compact-list">
            {!loading && data.orders.items.slice(0, 4).map((item) => (
              <Link href={`/one-time-orders/${item.id}`} key={item.id}>
                <span><strong>{item.title}</strong><small>{item.linkedObject?.name ?? item.executionAddress}</small></span>
                <em>{statusLabel(item.status)}</em>
              </Link>
            ))}
            {!loading && data.orders.items.length === 0 ? <div className="dashboard-v2__empty">Нет доступных разовых заказов.</div> : null}
          </div>
        </section>

        <section className="dashboard-v2__panel">
          <header className="dashboard-v2__panel-head">
            <div><span className="dashboard-v2__kicker">Контур</span><h2>Объекты</h2></div>
            <Link href="/objects">Все объекты</Link>
          </header>
          <div className="dashboard-v2__summary-line"><strong>{loading ? '—' : activeObjects}</strong><span>активных объектов</span><b>{loading ? '—' : data.objects.reduce((sum, item) => sum + item.employees.length, 0)} назначений сотрудников</b></div>
          <div className="dashboard-v2__compact-list">
            {!loading && data.objects.slice(0, 4).map((item) => (
              <Link href={`/objects/${item.id}`} key={item.id}>
                <span><strong>{item.name}</strong><small>{item.responsible?.fullName ?? 'Ответственный не назначен'}</small></span>
                <em>{item.employees.length} чел.</em>
              </Link>
            ))}
            {!loading && data.objects.length === 0 ? <div className="dashboard-v2__empty">Нет доступных объектов.</div> : null}
          </div>
        </section>

        <section className="dashboard-v2__panel dashboard-v2__panel--people">
          <header className="dashboard-v2__panel-head">
            <div><span className="dashboard-v2__kicker">Команда</span><h2>Люди</h2></div>
            <Link href="/employees">Сотрудники</Link>
          </header>
          <div className="dashboard-v2__people-number">{loading ? '—' : data.employees.total}</div>
          <p>Активных сотрудников в доступном вам контуре.</p>
          <div className="dashboard-v2__people-actions">
            <Link href="/employees?hasActiveObjectAssignment=false">Без объекта</Link>
            {user?.capabilities?.canAccessCandidates ? <Link href="/candidates">Кандидаты</Link> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
