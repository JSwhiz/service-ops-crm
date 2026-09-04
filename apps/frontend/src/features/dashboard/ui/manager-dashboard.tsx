'use client';

import React, { useEffect, useState } from 'react';

import { getManagerDashboard } from '@/entities/dashboard/api/dashboard-client';
import type { ManagerDashboardResponse, ManagerIssue } from '@/entities/dashboard/model/dashboard.types';
import type { TaskItem } from '@/entities/task/model/task.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

import {
  DashboardEmpty,
  DashboardMetric,
  DashboardPanel,
  DashboardRow,
  DashboardRows,
  DashboardSummaryStrip,
} from './dashboard-primitives';
import {
  LeadershipPreviewDrawer,
  type LeadershipPreviewTarget,
} from './leadership-preview-drawer';
import styles from './operation-manager-dashboard.module.css';

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
  }).format(new Date()));
  return hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
}
function firstName(value: string): string { return value.trim().split(/\s+/)[0] || value; }
function formatDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(value));
}
function taskTime(task: TaskItem): string { return task.isOverdue ? `до ${formatDate(task.dueAt)}` : formatDate(task.dueAt); }
function scopeLabel(mode: ManagerDashboardResponse['scope']['mode']): string {
  return { regular: 'Основные объекты', one_time: 'Разовые заказы', hybrid: 'Объекты и разовые', empty: 'Нет активных назначений' }[mode];
}
function issueLabel(issue: ManagerIssue): string {
  return {
    object_no_employees: 'нет сотрудников',
    object_attendance_missing: 'нет отметки',
    object_daily_report_missing: 'нет отчёта',
    order_no_employees: 'нет сотрудников',
    order_attendance_missing: 'нет отметки',
    order_daily_report_missing: 'нет отчёта',
  }[issue];
}
function issueHref(issue: ManagerIssue, entityId?: string): string {
  if (issue.startsWith('order_')) {
    return entityId ? `/one-time-orders/${entityId}` : '/one-time-orders/attention';
  }
  const regular = issue.replace('object_', '')
    .replace('no_employees', 'no_employees')
    .replace('attendance_missing', 'attendance_missing')
    .replace('daily_report_missing', 'daily_report_missing');
  return entityId ? `/objects/${entityId}` : `/objects?status=active&issue=${regular}`;
}

export function ManagerDashboard(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<ManagerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<LeadershipPreviewTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setPreview(null);
    void getManagerDashboard()
      .then((response) => { if (!cancelled) setData(response); })
      .catch(() => { if (!cancelled) { setData(null); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const name = user ? firstName(getUserDisplayName(user)) : '';
  const showRegular = data?.scope.mode === 'regular' || data?.scope.mode === 'hybrid';
  const showOneTime = data?.scope.mode === 'one_time' || data?.scope.mode === 'hybrid';

  return (
    <>
      <div className={styles.root}>
        <section className={styles.intro}>
          <div>
            <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
            <p>{loading ? 'Обновляем рабочую сводку…' : data ? `${scopeLabel(data.scope.mode)} · ${data.attention.total ? `${data.attention.total} сигналов требуют внимания` : 'срочных вопросов нет'}` : 'Рабочая сводка'}</p>
          </div>
          <span className={`${styles.health} ${data?.attention.total ? styles.healthAttention : ''}`}><i />{loading ? 'Обновление' : data?.attention.total ? 'Есть приоритеты' : 'Спокойный контур'}</span>
        </section>

        {failed ? <div className={styles.notice}>Рабочую сводку не удалось обновить полностью. Повторите загрузку страницы.</div> : null}

        <DashboardSummaryStrip label="Сегодня">
          <DashboardMetric value={data?.today.regularObjects ?? '—'} label="моих объектов" href="/objects?status=active" />
          <DashboardMetric value={data?.today.oneTimeOrders ?? '—'} label="разовых сегодня" href="/one-time-orders/attention" />
          <DashboardMetric value={(data?.today.regularAttendanceMissing ?? 0) + (data?.today.oneTimeAttendanceMissing ?? 0)} label="без отметки" alert={Boolean((data?.today.regularAttendanceMissing ?? 0) + (data?.today.oneTimeAttendanceMissing ?? 0))} onClick={() => setPreview({ kind: 'summary', item: {
            eyebrow: 'Сегодня', title: 'Нет отметки присутствия',
            facts: [
              { label: 'Основные объекты', value: String(data?.today.regularAttendanceMissing ?? 0) },
              { label: 'Разовые', value: String(data?.today.oneTimeAttendanceMissing ?? 0) },
            ], href: '/objects?status=active&issue=attendance_missing', secondaryHref: '/one-time-orders/attention', secondaryLabel: 'Разовые заказы',
          } })} />
          <DashboardMetric value={data?.today.myTasksToday ?? '—'} label="моих задач" href="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc" />
        </DashboardSummaryStrip>

        <div className={styles.grid}>
          <div className={styles.column}>
            <div className={styles.wide}>
              <DashboardPanel title="Требует внимания" count={data?.attention.total ?? 0}>
                <DashboardRows>
                  {loading ? <DashboardEmpty>Загружаем сигналы…</DashboardEmpty> : (data?.attention.items ?? []).length === 0 ? <DashboardEmpty><strong>Нет срочных вопросов</strong></DashboardEmpty> : (data?.attention.items ?? []).map((item) => (
                    <DashboardRow key={item.id} badge={item.badge} tone={item.tone} title={item.title} subtitle={item.subtitle} meta={item.meta} onClick={() => {
                      if (item.kind === 'task' && item.taskId) {
                        const task = data?.tasks.items.find((candidate) => candidate.id === item.taskId);
                        if (task) { setPreview({ kind: 'task', item: task }); return; }
                      }
                      setPreview({ kind: 'summary', item: {
                        eyebrow: item.issueCode?.startsWith('order_') ? 'Разовый заказ' : 'Объект',
                        title: item.title, subtitle: item.subtitle,
                        facts: [{ label: 'Состояние', value: item.meta }],
                        href: item.issueCode ? issueHref(item.issueCode, item.entityId) : '/tasks',
                        actionLabel: 'Открыть →',
                      } });
                    }} />
                  ))}
                </DashboardRows>
              </DashboardPanel>
            </div>

            {showRegular ? <DashboardPanel title="Мои объекты" count={data?.objects.total ?? 0} actionHref="/objects?status=active" actionLabel="Все →">
              <DashboardRows>
                {(data?.objects.items ?? []).length === 0 && !loading ? <DashboardEmpty>Нет активных назначенных объектов.</DashboardEmpty> : (data?.objects.items ?? []).map((item) => (
                  <DashboardRow key={item.id} title={item.name} subtitle={item.address} meta={`${item.employeeCount} чел.`} badge={item.issues.length ? item.issues.length : undefined} tone={item.issues.length ? 'warning' : 'neutral'} onClick={() => setPreview({ kind: 'summary', item: {
                    eyebrow: 'Объект', title: item.name, subtitle: item.address,
                    facts: [
                      { label: 'Сотрудники', value: String(item.employeeCount) },
                      { label: 'Состояние', value: item.issues.length ? item.issues.map(issueLabel).join(', ') : 'Без операционных проблем' },
                    ], href: `/objects/${item.id}`, actionLabel: 'Открыть полностью →',
                  } })} />
                ))}
              </DashboardRows>
            </DashboardPanel> : null}
          </div>

          <div className={styles.column}>
            {showOneTime ? <DashboardPanel title="Мои разовые заказы" count={data?.orders.total ?? 0} actionHref="/one-time-orders/attention" actionLabel="Все →">
              <DashboardRows>
                {(data?.orders.items ?? []).length === 0 && !loading ? <DashboardEmpty>Нет активных разовых заказов.</DashboardEmpty> : (data?.orders.items ?? []).map((order) => (
                  <DashboardRow key={order.id} title={order.title} subtitle={order.executionAddress} meta={formatDate(order.executionStartDate)} badge={order.issues.length ? order.issues.length : undefined} tone={order.issues.length ? 'warning' : 'neutral'} onClick={() => setPreview({ kind: 'summary', item: {
                    eyebrow: 'Разовый заказ', title: order.title, subtitle: order.executionAddress,
                    facts: [
                      { label: 'Сотрудники', value: String(order.employeeCount) },
                      { label: 'Состояние', value: order.issues.length ? order.issues.map(issueLabel).join(', ') : 'Без операционных проблем' },
                    ], href: `/one-time-orders/${order.id}`, secondaryHref: `/one-time-orders/${order.id}/workforce`, secondaryLabel: 'Сотрудники и табель', actionLabel: 'Открыть заказ →',
                  } })} />
                ))}
              </DashboardRows>
            </DashboardPanel> : null}

            <DashboardPanel title="Мои задачи" count={data?.tasks.totalRelevant ?? 0} actionHref="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc" actionLabel="В реестр →">
              <DashboardRows>
                {(data?.tasks.items ?? []).length === 0 && !loading ? <DashboardEmpty>Ближайших задач нет.</DashboardEmpty> : (data?.tasks.items ?? []).map((task) => (
                  <DashboardRow key={task.id} badge={task.myAssignment ? 'Моя' : 'Контур'} tone={task.isOverdue ? 'danger' : 'neutral'} title={task.title} subtitle={task.targetName || 'Без привязки'} meta={taskTime(task)} onClick={() => setPreview({ kind: 'task', item: task })} />
                ))}
              </DashboardRows>
            </DashboardPanel>

            <DashboardPanel title="Склад" actionHref="/inventory" actionLabel="Открыть →">
              <DashboardRows>
                <DashboardRow title="Расходники" subtitle="Каталог и текущие остатки доступны для просмотра" meta="read-only" href="/inventory" />
                <DashboardRow title="Оборудование" subtitle="Свободное можно назначить только в свой рабочий scope" meta="scoped" href="/equipment" />
              </DashboardRows>
            </DashboardPanel>
          </div>
        </div>
      </div>
      <LeadershipPreviewDrawer target={preview} onClose={() => setPreview(null)} />
    </>
  );
}
