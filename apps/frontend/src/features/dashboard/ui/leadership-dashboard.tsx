'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { getAccountabilityAccountByUserId, listAccountabilityAccounts } from '@/entities/accountability/api/accountability-client';
import { listApprovalRequests } from '@/entities/approval/api/approval-client';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import { listCandidates } from '@/entities/candidate/api/candidate-client';
import { listEmployees } from '@/entities/employee/api/employee-client';
import type { EmployeeListResponse } from '@/entities/employee/model/employee.types';
import { getTodayDailyReport, getTodayObjectAttendance } from '@/entities/object/api/object-operations-client';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem, OneTimeOrderListResponse } from '@/entities/one-time-order/model/one-time-order.types';
import { listTasks } from '@/entities/task/api/task-client';
import type { TaskItem, TaskListResponse } from '@/entities/task/model/task.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './leadership-dashboard.module.css';

type MoneyState = {
  submitted: number;
  closures: number;
  receiptCount: number;
  receiptAmount: number;
};

type ObjectSignal = {
  attendanceMissing: boolean;
  dailyReportMissing: boolean;
};

type AttentionRow = {
  id: string;
  href: string;
  badge: string;
  tone: 'danger' | 'warning' | 'neutral';
  title: string;
  subtitle: string;
  meta: string;
};

const EMPTY_TASKS: TaskListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_ORDERS: OneTimeOrderListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_EMPLOYEES: EmployeeListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0, capabilities: { canCreate: false } };
const EMPTY_MONEY: MoneyState = { submitted: 0, closures: 0, receiptCount: 0, receiptAmount: 0 };
const PREVIEW_LIMIT = 5;
const EXPANDED_LIMIT = 14;

function moscowNow(): { date: string; minutes: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((item) => item.type === type)?.value ?? '0';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + minute, hour };
}

function greeting(): string {
  const hour = moscowNow().hour;
  if (hour < 6) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || value;
}

function dateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function formatDate(value: string | null): string {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: 'short',
  }).format(new Date(value));
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₽`;
}

function taskIsMine(task: TaskItem, userId: string | undefined): boolean {
  return Boolean(task.myAssignment || task.assignees.some((item) => item.id === userId && item.isActive));
}

function taskTime(task: TaskItem): string {
  if (task.isOverdue) return task.dueAt ? `до ${formatDate(task.dueAt)}` : 'Просрочено';
  if (!task.dueAt) return 'Без срока';
  const key = dateKey(task.dueAt);
  if (key === moscowNow().date) return 'Сегодня';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === dateKey(tomorrow)) return 'Завтра';
  return formatDate(task.dueAt);
}

function rankTasks(items: TaskItem[], userId: string | undefined): TaskItem[] {
  const today = moscowNow().date;
  return items
    .filter((task) => !['completed', 'cancelled'].includes(task.status))
    .filter((task) => taskIsMine(task, userId) || task.isOverdue)
    .sort((a, b) => {
      const rank = (task: TaskItem): number => {
        const mine = taskIsMine(task, userId);
        const dueToday = Boolean(task.dueAt && dateKey(task.dueAt) === today);
        const createdToday = dateKey(task.createdAt) === today;
        if (mine && task.isOverdue) return 0;
        if (mine && dueToday) return 1;
        if (mine && createdToday) return 2;
        if (mine && task.dueAt) return 3;
        if (mine) return 4;
        if (task.isOverdue) return 5;
        return 6;
      };
      const delta = rank(a) - rank(b);
      if (delta !== 0) return delta;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function approvalHref(item: ApprovalRequestItem): string {
  const params = new URLSearchParams({ status: 'pending', sourceEntityType: item.sourceEntityType, sourceEntityId: item.sourceEntityId });
  return `/approvals?${params.toString()}`;
}

function orderTimestamp(item: OneTimeOrderListItem): number {
  if (!item.executionStartDate) return Number.MAX_SAFE_INTEGER;
  return new Date(`${item.executionStartDate.slice(0, 10)}T00:00:00`).getTime();
}

function rankOrders(items: OneTimeOrderListItem[]): OneTimeOrderListItem[] {
  const today = moscowNow().date;
  return items
    .filter((item) => !['completed', 'cancelled'].includes(item.status))
    .sort((a, b) => {
      const aDate = a.executionStartDate?.slice(0, 10) ?? null;
      const bDate = b.executionStartDate?.slice(0, 10) ?? null;
      const group = (value: string | null): number => !value ? 3 : value < today ? 0 : value === today ? 1 : 2;
      const delta = group(aDate) - group(bDate);
      return delta !== 0 ? delta : orderTimestamp(a) - orderTimestamp(b);
    });
}

function orderStatus(value: string): string {
  return ({ in_progress: 'В работе', active: 'Активен', planned: 'Запланирован', new: 'Новый', draft: 'Черновик' } as Record<string, string>)[value] ?? value.replaceAll('_', ' ');
}

function orderDate(item: OneTimeOrderListItem): string {
  if (!item.executionStartDate) return 'Без даты';
  const key = item.executionStartDate.slice(0, 10);
  const today = moscowNow().date;
  if (key === today) return 'Сегодня';
  if (key < today) return `Просрочен · ${formatDate(item.executionStartDate)}`;
  return formatDate(item.executionStartDate);
}

export function LeadershipDashboard(): React.JSX.Element {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalRequestItem[]>([]);
  const [tasks, setTasks] = useState<TaskListResponse>(EMPTY_TASKS);
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderListResponse>(EMPTY_ORDERS);
  const [employees, setEmployees] = useState<EmployeeListResponse>(EMPTY_EMPLOYEES);
  const [unassignedEmployees, setUnassignedEmployees] = useState(0);
  const [overdueCandidates, setOverdueCandidates] = useState(0);
  const [money, setMoney] = useState<MoneyState>(EMPTY_MONEY);
  const [signals, setSignals] = useState<Record<string, ObjectSignal>>({});
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState(false);
  const [attentionExpanded, setAttentionExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => { setLoadWarning(true); return fallback; });

    const loadMoney = async (): Promise<MoneyState> => {
      if (!user.capabilities?.canReviewAccountability) return EMPTY_MONEY;
      const accountItems = await safe(listAccountabilityAccounts(), []);
      const details = await Promise.all(accountItems.map((item) => safe(getAccountabilityAccountByUserId(item.user.id), null)));
      const valid = details.filter((item): item is NonNullable<typeof item> => item !== null);
      const receipts = valid.flatMap((item) => item.fundings)
        .filter((item) => item.fundingType === 'one_time_order_receipt' && item.entryDirection === 'credit');
      return {
        submitted: accountItems.reduce((sum, item) => sum + item.summary.submittedExpensesCount, 0),
        closures: accountItems.filter((item) => item.status === 'closing_requested').length,
        receiptCount: receipts.length,
        receiptAmount: receipts.reduce((sum, item) => sum + Number(item.amount), 0),
      };
    };

    const loadSignals = async (items: ServiceObject[]): Promise<Record<string, ObjectSignal>> => {
      const now = moscowNow();
      const attendanceRequired = now.minutes >= 8 * 60 + 30;
      const reportRequired = now.minutes >= 17 * 60;
      const active = items.filter((item) => item.status === 'active');
      const rows = await Promise.all(active.map(async (item) => {
        const attendance = attendanceRequired ? await safe(getTodayObjectAttendance(item.id), undefined) : undefined;
        const report = reportRequired ? await safe(getTodayDailyReport(item.id), undefined) : undefined;
        return [item.id, {
          attendanceMissing: attendanceRequired && attendance !== undefined && attendance.submittedAt === null,
          dailyReportMissing: reportRequired && report !== undefined && report === null,
        }] as const;
      }));
      return Object.fromEntries(rows);
    };

    setLoading(true);
    setLoadWarning(false);
    void Promise.all([
      safe(listApprovalRequests({ status: 'pending' }), []),
      safe(listTasks({ page: 1, limit: 60, sortBy: 'dueAt', sortDirection: 'asc' }), EMPTY_TASKS),
      safe(listObjects(), []),
      safe(listOneTimeOrders({ page: 1, limit: 20, sortBy: 'executionStartDate', sortDirection: 'asc' }), EMPTY_ORDERS),
      safe(listEmployees({ archiveState: 'active', page: 1, limit: 1 }), EMPTY_EMPLOYEES),
      safe(listEmployees({ archiveState: 'active', hasActiveObjectAssignment: false, page: 1, limit: 1 }), EMPTY_EMPLOYEES),
      user.capabilities?.canAccessCandidates
        ? safe(listCandidates({ archiveState: 'active', slaState: 'overdue', page: 1, limit: 1 }), { items: [], page: 1, limit: 1, total: 0, totalPages: 0 })
        : Promise.resolve({ items: [], page: 1, limit: 1, total: 0, totalPages: 0 }),
      loadMoney(),
    ]).then(async ([nextApprovals, nextTasks, nextObjects, nextOrders, nextEmployees, unassigned, candidates, nextMoney]) => {
      const nextSignals = await loadSignals(nextObjects);
      if (cancelled) return;
      setApprovals(nextApprovals);
      setTasks(nextTasks);
      setObjects(nextObjects);
      setOrders(nextOrders);
      setEmployees(nextEmployees);
      setUnassignedEmployees(unassigned.total);
      setOverdueCandidates(candidates.total);
      setMoney(nextMoney);
      setSignals(nextSignals);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [user]);

  const activeObjects = useMemo(() => objects.filter((item) => item.status === 'active'), [objects]);
  const noResponsible = useMemo(() => activeObjects.filter((item) => !item.responsible), [activeObjects]);
  const noEmployees = useMemo(() => activeObjects.filter((item) => item.employees.length === 0), [activeObjects]);
  const noAttendance = useMemo(() => activeObjects.filter((item) => signals[item.id]?.attendanceMissing), [activeObjects, signals]);
  const noReport = useMemo(() => activeObjects.filter((item) => signals[item.id]?.dailyReportMissing), [activeObjects, signals]);
  const problemObjects = useMemo(() => activeObjects.filter((item) =>
    !item.responsible || item.employees.length === 0 || signals[item.id]?.attendanceMissing || signals[item.id]?.dailyReportMissing,
  ), [activeObjects, signals]);
  const objectPreview = useMemo(() => [...problemObjects, ...activeObjects.filter((item) => !problemObjects.some((problem) => problem.id === item.id))].slice(0, 4), [activeObjects, problemObjects]);
  const rankedTasks = useMemo(() => rankTasks(tasks.items, user?.id), [tasks.items, user?.id]);
  const rankedOrders = useMemo(() => rankOrders(orders.items).slice(0, 3), [orders.items]);
  const todayOrders = useMemo(() => orders.items.filter((item) => item.executionStartDate?.slice(0, 10) === moscowNow().date && !['completed', 'cancelled'].includes(item.status)).length, [orders.items]);
  const assignmentCount = useMemo(() => activeObjects.reduce((sum, item) => sum + item.employees.length, 0), [activeObjects]);

  const attentionRows = useMemo<AttentionRow[]>(() => {
    const rows: AttentionRow[] = [];
    if (noAttendance.length) rows.push({ id: 'attendance', href: '/objects?status=active&issue=attendance_missing', badge: 'Объекты', tone: 'warning', title: 'Нет отметки присутствия', subtitle: `${noAttendance.length} объектов без отправленной отметки за рабочий день`, meta: 'Сегодня' });
    if (noReport.length) rows.push({ id: 'report', href: '/objects?status=active&issue=daily_report_missing', badge: 'Отчёт', tone: 'warning', title: 'Нет дневного отчёта', subtitle: `${noReport.length} объектов без отчёта после 17:00`, meta: 'Сегодня' });
    if (noResponsible.length) rows.push({ id: 'responsible', href: '/objects?status=active&issue=without_responsible', badge: 'Объекты', tone: 'warning', title: 'Нет ответственного', subtitle: `${noResponsible.length} активных объектов без ответственного`, meta: 'Сейчас' });
    if (noEmployees.length) rows.push({ id: 'employees', href: '/objects?status=active&issue=without_employees', badge: 'Объекты', tone: 'warning', title: 'Нет сотрудников', subtitle: `${noEmployees.length} активных объектов без назначенных сотрудников`, meta: 'Сейчас' });
    rows.push(...tasks.items.filter((task) => task.isOverdue && task.status !== 'completed').map((task) => ({ id: `task-${task.id}`, href: `/tasks/${task.id}`, badge: 'Просрочено', tone: 'danger' as const, title: task.title, subtitle: task.targetName || 'Без привязки', meta: taskTime(task) })));
    rows.push(...approvals.map((item) => ({ id: `approval-${item.id}`, href: approvalHref(item), badge: 'Согласование', tone: 'warning' as const, title: item.summary.title, subtitle: item.summary.subtitle ?? 'Ожидает решения', meta: formatDate(item.createdAt) })));
    rows.push(...tasks.items.filter((task) => task.status === 'awaiting_confirmation' && !task.isOverdue).map((task) => ({ id: `confirm-${task.id}`, href: `/tasks/${task.id}`, badge: 'Подтверждение', tone: 'neutral' as const, title: task.title, subtitle: task.targetName || 'Без привязки', meta: taskTime(task) })));
    const seen = new Set<string>();
    return rows.filter((row) => { const key = row.id.replace(/^confirm-/, 'task-'); if (seen.has(key)) return false; seen.add(key); return true; });
  }, [approvals, noAttendance.length, noEmployees.length, noReport.length, noResponsible.length, tasks.items]);

  const visibleAttention = attentionRows.slice(0, attentionExpanded ? EXPANDED_LIMIT : PREVIEW_LIMIT);
  const visibleTasks = rankedTasks.slice(0, tasksExpanded ? EXPANDED_LIMIT : PREVIEW_LIMIT);
  const displayName = user ? firstName(getUserDisplayName(user)) : '';
  const decisionCount = approvals.length;

  return (
    <div className={styles.root}>
      <section className={styles.intro}>
        <div><h1>{greeting()}{displayName ? `, ${displayName}` : ''}</h1><p>{loading ? 'Обновляем рабочую сводку…' : attentionRows.length ? `На сегодня ${attentionRows.length} ${attentionRows.length === 1 ? 'сигнал требует' : 'сигналов требуют'} внимания` : 'На сегодня срочных вопросов нет'}</p></div>
        <span className={`${styles.health} ${attentionRows.length ? styles.healthAttention : ''}`}><i />{loading ? 'Обновление' : attentionRows.length ? 'Есть приоритеты' : 'Спокойный контур'}</span>
      </section>

      {loadWarning ? <div className={styles.notice}>Часть данных временно недоступна. Доступные показатели показаны без подстановки значений.</div> : null}

      <section className={styles.today} aria-label="Сегодня">
        <div className={styles.todayLabel}>Сегодня</div>
        <Link href="/objects?status=active"><strong>{loading ? '—' : activeObjects.length}</strong><span>активных объектов</span></Link>
        <Link href="/employees?archiveState=active&hasActiveObjectAssignment=true"><strong>{loading ? '—' : assignmentCount}</strong><span>назначений на объекты</span></Link>
        <Link className={noAttendance.length ? styles.alertLink : ''} href="/objects?status=active&issue=attendance_missing"><strong>{loading ? '—' : noAttendance.length}</strong><span>без отметки</span></Link>
        <Link href={`/one-time-orders?dateFrom=${moscowNow().date}&dateTo=${moscowNow().date}&sortBy=executionStartDate&sortDirection=asc`}><strong>{loading ? '—' : todayOrders}</strong><span>разовых сегодня</span></Link>
        <Link className={decisionCount ? styles.alertLink : ''} href="/approvals?status=pending"><strong>{loading ? '—' : decisionCount}</strong><span>согласований от вас</span></Link>
      </section>

      <div className={styles.grid}>
        <div className={styles.column}>
          <section className={styles.panel}>
            <header className={styles.head}><div className={styles.headTitle}><h2>Требует внимания</h2><span className={styles.count}>{attentionRows.length}</span></div>{attentionRows.length > PREVIEW_LIMIT ? <button className={styles.expandButton} type="button" onClick={() => setAttentionExpanded((value) => !value)}>{attentionExpanded ? 'Свернуть' : `Ещё ${attentionRows.length - PREVIEW_LIMIT}`}</button> : null}</header>
            <div className={styles.rows}>{!loading && !attentionRows.length ? <div className={styles.empty}><strong>Нет срочных вопросов</strong></div> : visibleAttention.map((item) => <Link className={`${styles.row} ${styles.attentionRow}`} href={item.href} key={item.id}><span className={`${styles.badge} ${styles[item.tone]}`}>{item.badge}</span><span className={styles.copy}><strong>{item.title}</strong><small>{item.subtitle}</small></span><span className={styles.meta}>{item.meta}</span></Link>)}</div>
          </section>

          <section className={styles.panel}>
            <header className={styles.head}><div className={styles.headTitle}><h2>Объекты</h2>{problemObjects.length ? <span className={styles.count}>{problemObjects.length}</span> : null}</div><Link href={problemObjects.length ? '/objects?status=active&issue=attention' : '/objects?status=active'}>{problemObjects.length ? 'Проблемные' : 'Все'} →</Link></header>
            <div className={styles.sectionSummary}><strong>{loading ? '—' : activeObjects.length}</strong><span>активных</span><span>{problemObjects.length ? `${problemObjects.length} требуют внимания` : 'Проблем не обнаружено'}</span></div>
            <div className={styles.rows}>{objectPreview.map((item) => { const issues = [!item.responsible ? 'нет ответственного' : null, item.employees.length === 0 ? 'нет сотрудников' : null, signals[item.id]?.attendanceMissing ? 'нет отметки' : null, signals[item.id]?.dailyReportMissing ? 'нет отчёта' : null].filter(Boolean); return <Link className={`${styles.row} ${styles.objectRow}`} href={`/objects/${item.id}`} key={item.id}><span className={styles.copy}><strong>{item.name}</strong><small>{item.address}</small></span><span className={`${styles.meta} ${issues.length ? styles.problem : ''}`}>{issues.length ? issues.join(' · ') : item.responsible?.fullName ?? '—'}</span><span className={styles.meta}>{item.employees.length} чел.</span></Link>; })}</div>
          </section>
        </div>

        <div className={styles.column}>
          <section className={styles.panel}>
            <header className={styles.head}><div className={styles.headTitle}><h2>Мои задачи</h2><span className={styles.count}>{rankedTasks.length}</span></div><div className={styles.headActions}>{rankedTasks.length > PREVIEW_LIMIT ? <button className={styles.expandButton} type="button" onClick={() => setTasksExpanded((value) => !value)}>{tasksExpanded ? 'Свернуть' : `Ещё ${rankedTasks.length - PREVIEW_LIMIT}`}</button> : null}<Link href="/tasks?mode=assigned&sortBy=dueAt&sortDirection=asc">В реестр →</Link></div></header>
            <div className={styles.rows}>{!loading && !visibleTasks.length ? <div className={styles.empty}>Ближайших задач нет.</div> : visibleTasks.map((task) => { const mine = taskIsMine(task, user?.id); const dueToday = Boolean(task.dueAt && dateKey(task.dueAt) === moscowNow().date); return <Link className={`${styles.row} ${styles.taskRow}`} href={`/tasks/${task.id}`} key={task.id}><span className={`${styles.badge} ${task.isOverdue ? styles.danger : dueToday ? styles.warning : styles.neutral}`}>{task.isOverdue ? 'Просрочено' : dueToday ? 'Сегодня' : mine ? 'Назначено' : 'Компания'}</span><span className={styles.copy}><strong>{task.title}</strong><small>{task.targetName || 'Без привязки'}</small></span><span className={styles.metaStrong}>{taskTime(task)}</span></Link>; })}</div>
          </section>

          {user?.capabilities?.canReviewAccountability ? <section className={styles.panel}><header className={styles.head}><div className={styles.headTitle}><h2>Деньги</h2>{money.submitted + money.closures ? <span className={styles.count}>{money.submitted + money.closures}</span> : null}</div><Link href="/accountability">Подотчёт →</Link></header><div className={styles.triplet}><Link href="/accountability/queue?view=submitted"><span>Расходы на проверке</span><strong>{loading ? '—' : money.submitted}</strong><small>ожидают решения</small></Link><Link href="/accountability/queue?view=closing"><span>Закрытие подотчёта</span><strong>{loading ? '—' : money.closures}</strong><small>ждут решения</small></Link><Link href="/accountability/queue?view=one_time_receipts"><span>Приход по разовым</span><strong>{loading ? '—' : formatMoney(money.receiptAmount)}</strong><small>{money.receiptCount} поступлений</small></Link></div></section> : null}

          <section className={styles.panel}><header className={styles.head}><div className={styles.headTitle}><h2>Разовые заказы</h2></div><Link href="/one-time-orders?sortBy=executionStartDate&sortDirection=asc">По сроку →</Link></header><div className={styles.rows}>{!loading && !rankedOrders.length ? <div className={styles.empty}>Нет активных заказов.</div> : rankedOrders.map((item) => <Link className={`${styles.row} ${styles.orderRow}`} href={`/one-time-orders/${item.id}`} key={item.id}><span className={styles.copy}><strong>{item.title}</strong><small>{item.linkedObject?.name ?? item.executionAddress}</small></span><span className={styles.meta}>{orderStatus(item.status)}</span><span className={`${styles.meta} ${item.executionStartDate?.slice(0, 10) && item.executionStartDate.slice(0, 10) < moscowNow().date ? styles.problem : ''}`}>{orderDate(item)}</span></Link>)}</div></section>

          <section className={styles.panel}><header className={styles.head}><div className={styles.headTitle}><h2>Люди</h2></div><Link href="/employees?archiveState=active">Все →</Link></header><div className={styles.triplet}><Link href="/employees?archiveState=active"><strong>{loading ? '—' : employees.total}</strong><span>активных сотрудников</span></Link><Link href="/employees?archiveState=active&hasActiveObjectAssignment=false"><strong>{loading ? '—' : unassignedEmployees}</strong><span>без объекта</span></Link>{user?.capabilities?.canAccessCandidates ? <Link href="/candidates?archiveState=active&slaState=overdue"><strong>{loading ? '—' : overdueCandidates}</strong><span>кандидатов с просроченным SLA</span></Link> : <div><strong>—</strong><span>кандидаты недоступны</span></div>}</div></section>
        </div>
      </div>
    </div>
  );
}
