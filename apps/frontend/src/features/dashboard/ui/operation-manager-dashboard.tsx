'use client';

import React, { useEffect, useState } from 'react';

import { getOperationManagerDashboard } from '@/entities/dashboard/api/dashboard-client';
import type {
  OperationManagerAttentionItem,
  OperationManagerDashboardResponse,
  OperationManagerObjectIssue,
} from '@/entities/dashboard/model/dashboard.types';
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
import styles from './operation-manager-dashboard.module.css';
import {
  LeadershipPreviewDrawer,
  type LeadershipPreviewTarget,
} from './leadership-preview-drawer';

function moscowHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(new Date()));
}
function greeting(): string {
  const hour = moscowHour();
  return hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
}
function firstName(value: string): string { return value.trim().split(/\s+/)[0] || value; }
function formatDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(value));
}
function issueLabel(issue: OperationManagerObjectIssue): string {
  return { no_employees: 'нет сотрудников', attendance_missing: 'нет отметки', daily_report_missing: 'нет отчёта' }[issue];
}
function issueHref(issue: OperationManagerObjectIssue): string {
  return `/objects?status=active&issue=${issue}`;
}
function taskTime(task: TaskItem): string {
  return task.isOverdue ? (task.dueAt ? `до ${formatDate(task.dueAt)}` : 'Просрочено') : formatDate(task.dueAt);
}
function orderStatus(value: string): string {
  return ({ in_progress: 'В работе', active: 'Активен', planned: 'Запланирован', new: 'Новый', draft: 'Черновик' } as Record<string, string>)[value] ?? value.replaceAll('_', ' ');
}
function orderDate(value: string | null): string { return value ? formatDate(value) : 'Без даты'; }

export function OperationManagerDashboard(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<OperationManagerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<LeadershipPreviewTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setPreview(null);
    void getOperationManagerDashboard()
      .then((response) => { if (!cancelled) setData(response); })
      .catch(() => { if (!cancelled) { setData(null); setFailed(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const name = user ? firstName(getUserDisplayName(user)) : '';
  const attention = data?.attention.items ?? [];

  const openAttention = (item: OperationManagerAttentionItem): void => {
    if (item.kind === 'task' && item.taskId) {
      const task = data?.tasks.items.find((candidate) => candidate.id === item.taskId);
      if (task) { setPreview({ kind: 'task', item: task }); return; }
    }
    const href = item.objectIssueCode ? issueHref(item.objectIssueCode) : '/tasks';
    setPreview({ kind: 'summary', item: {
      eyebrow: item.kind === 'object_issue' ? 'Объекты' : 'Задачи',
      title: item.title,
      subtitle: item.subtitle,
      facts: [{ label: 'Состояние', value: item.meta }],
      href,
      actionLabel: 'Открыть выборку →',
    } });
  };

  return (
    <>
      <div className={styles.root}>
        <section className={styles.intro}>
          <div>
            <h1>{greeting()}{name ? `, ${name}` : ''}</h1>
            <p>{loading ? 'Обновляем оперативную сводку…' : data?.attention.total ? `На сегодня ${data.attention.total} сигналов требуют внимания` : 'На сегодня срочных вопросов нет'}</p>
          </div>
          <span className={`${styles.health} ${data?.attention.total ? styles.healthAttention : ''}`}><i />{loading ? 'Обновление' : data?.attention.total ? 'Есть приоритеты' : 'Спокойный контур'}</span>
        </section>

        {failed ? <div className={styles.notice}>Оперативную сводку не удалось обновить полностью. Повторите загрузку страницы.</div> : null}

        <DashboardSummaryStrip label="Сегодня">
          <DashboardMetric value={data?.today.activeObjects ?? '—'} label="моих объектов" href="/objects?status=active" />
          <DashboardMetric value={data?.today.employeesOnObjects ?? '—'} label="сотрудников на объектах" href="/employees?archiveState=active&hasActiveObjectAssignment=true" />
          <DashboardMetric value={data?.today.attendanceMissing ?? '—'} label="без отметки" alert={Boolean(data?.today.attendanceMissing)} href="/objects?status=active&issue=attendance_missing" />
          <DashboardMetric value={data?.today.dailyReportMissing ?? '—'} label="без отчёта" alert={Boolean(data?.today.dailyReportMissing)} href="/objects?status=active&issue=daily_report_missing" />
          <DashboardMetric value={data?.today.myTasksToday ?? '—'} label="моих задач сегодня" href="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc" />
        </DashboardSummaryStrip>

        <div className={styles.grid}>
          <div className={styles.column}>
            <div className={styles.wide}>
              <DashboardPanel title="Требует внимания" count={data?.attention.total ?? 0}>
                <DashboardRows>
                  {loading ? <DashboardEmpty>Загружаем сигналы…</DashboardEmpty> : attention.length === 0 ? <DashboardEmpty><strong>Нет срочных вопросов</strong></DashboardEmpty> : attention.map((item) => (
                    <DashboardRow key={item.id} badge={item.badge} tone={item.tone} title={item.title} subtitle={item.subtitle} meta={item.meta} onClick={() => openAttention(item)} />
                  ))}
                </DashboardRows>
              </DashboardPanel>
            </div>

            <DashboardPanel title="Мои объекты" count={data?.objects.problematic ?? 0} actionHref="/objects?status=active" actionLabel="Все →">
              <div className={styles.sectionSummary}><strong>{data?.objects.active ?? '—'}</strong><span>активных</span><span>{data?.objects.problematic ? `${data.objects.problematic} требуют внимания` : 'Проблем не обнаружено'}</span></div>
              <DashboardRows>
                {(data?.objects.items ?? []).map((item) => (
                  <DashboardRow
                    key={item.id}
                    title={item.name}
                    subtitle={item.address}
                    meta={`${item.employeeCount} чел.`}
                    onClick={() => setPreview({ kind: 'summary', item: {
                      eyebrow: 'Объект',
                      title: item.name,
                      subtitle: item.address,
                      facts: [
                        { label: 'Сотрудники', value: String(item.employeeCount) },
                        { label: 'Состояние', value: item.issues.length ? item.issues.map(issueLabel).join(', ') : 'Без операционных проблем' },
                      ],
                      href: `/objects/${item.id}`,
                      actionLabel: 'Открыть полностью →',
                    } })}
                  />
                ))}
              </DashboardRows>
            </DashboardPanel>
          </div>

          <div className={styles.column}>
            <DashboardPanel title="Мои задачи" count={data?.tasks.totalRelevant ?? 0} actionHref="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc" actionLabel="В реестр →">
              <DashboardRows>
                {(data?.tasks.items ?? []).length === 0 && !loading ? <DashboardEmpty>Ближайших задач нет.</DashboardEmpty> : (data?.tasks.items ?? []).map((task) => (
                  <DashboardRow key={task.id} badge={task.myAssignment ? 'Моя' : 'Контур'} tone={task.isOverdue ? 'danger' : 'neutral'} title={task.title} subtitle={task.targetName || 'Без привязки'} meta={taskTime(task)} onClick={() => setPreview({ kind: 'task', item: task })} />
                ))}
              </DashboardRows>
            </DashboardPanel>

            <DashboardPanel title="Разовые заказы" count={data?.orders.totalAccessible ?? 0} actionHref="/one-time-orders/attention" actionLabel="Горящие →">
              <DashboardRows>
                {(data?.orders.items ?? []).length === 0 && !loading ? <DashboardEmpty>Нет активных заказов в вашем контуре.</DashboardEmpty> : (data?.orders.items ?? []).map((order) => (
                  <DashboardRow key={order.id} title={order.title} subtitle={order.linkedObject?.name ?? order.executionAddress} meta={`${orderStatus(order.status)} · ${orderDate(order.executionStartDate)}`} onClick={() => setPreview({ kind: 'order', item: order })} />
                ))}
              </DashboardRows>
            </DashboardPanel>
          </div>
        </div>
      </div>

      <LeadershipPreviewDrawer target={preview} onClose={() => setPreview(null)} />
    </>
  );
}
