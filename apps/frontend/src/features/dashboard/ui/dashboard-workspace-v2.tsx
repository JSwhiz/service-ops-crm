'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

import { getAccountabilityAccountByUserId, listAccountabilityAccounts } from '@/entities/accountability/api/accountability-client';
import type { AccountabilityAccountListItem } from '@/entities/accountability/model/accountability.types';
import { listApprovalRequests } from '@/entities/approval/api/approval-client';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import { listCandidates } from '@/entities/candidate/api/candidate-client';
import { listEmployees } from '@/entities/employee/api/employee-client';
import type { EmployeeListResponse } from '@/entities/employee/model/employee.types';
import { getTodayDailyReport, getTodayObjectAttendance } from '@/entities/object/api/object-operations-client';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListResponse } from '@/entities/one-time-order/model/one-time-order.types';
import { listTasks } from '@/entities/task/api/task-client';
import type { TaskItem, TaskListResponse } from '@/entities/task/model/task.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getUserDisplayName } from '@/shared/lib/display-name';

import styles from './dashboard-workspace-v2.module.css';

type MoneyState = { accounts: AccountabilityAccountListItem[]; submitted: number; closures: number; receiptCount: number; receiptAmount: number };
type ObjectSignals = Record<string, { attendanceMissing: boolean; dailyReportMissing: boolean }>;
type DashboardData = { approvals: ApprovalRequestItem[]; tasks: TaskListResponse; objects: ServiceObject[]; orders: OneTimeOrderListResponse; employees: EmployeeListResponse; unassignedEmployees: number; overdueCandidates: number; money: MoneyState; objectSignals: ObjectSignals };

const EMPTY_TASKS: TaskListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_ORDERS: OneTimeOrderListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0 };
const EMPTY_EMPLOYEES: EmployeeListResponse = { items: [], page: 1, limit: 0, total: 0, totalPages: 0, capabilities: { canCreate: false } };
const EMPTY_MONEY: MoneyState = { accounts: [], submitted: 0, closures: 0, receiptCount: 0, receiptAmount: 0 };

function moscowParts(): { hour: number; minute: number; date: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return { hour: Number(get('hour')), minute: Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}
function greeting(): string { const h = moscowParts().hour; return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; }
function firstName(value: string): string { return value.trim().split(/\s+/)[0] || value; }
function dateKey(value: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function formatDate(value: string | null): string { return value ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short' }).format(new Date(value)) : 'Без срока'; }
function formatTaskTime(task: TaskItem): string { if (task.isOverdue) return task.dueAt ? `до ${formatDate(task.dueAt)}` : 'Просрочено'; if (!task.dueAt) return 'Без срока'; const today = dateKey(new Date()); const key = dateKey(new Date(task.dueAt)); if (key === today) return 'Сегодня'; const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); if (key === dateKey(tomorrow)) return 'Завтра'; return formatDate(task.dueAt); }
function money(value: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽'; }
function orderStatus(value: string): string { return ({ in_progress: 'В работе', active: 'Активен', completed: 'Завершён', cancelled: 'Отменён', draft: 'Черновик', planned: 'Запланирован', new: 'Новый' } as Record<string,string>)[value] ?? value.replaceAll('_',' '); }
function isAttendanceWindow(): boolean { const { hour, minute } = moscowParts(); const total = hour * 60 + minute; return total >= 8 * 60 + 30 && total <= 17 * 60; }
function isReportDue(): boolean { const { hour, minute } = moscowParts(); return hour * 60 + minute >= 17 * 60; }

function taskRank(task: TaskItem, userId: string | undefined): number {
  const mine = Boolean(task.myAssignment || task.assignees.some((assignee) => assignee.id === userId && assignee.isActive));
  const today = moscowParts().date;
  const dueToday = Boolean(task.dueAt && dateKey(new Date(task.dueAt)) === today);
  const createdToday = dateKey(new Date(task.createdAt)) === today;
  if (mine && task.isOverdue) return 0;
  if (mine && dueToday) return 1;
  if (mine && createdToday) return 2;
  if (mine && task.dueAt) return 3;
  if (task.isOverdue) return 4;
  return 5;
}
function taskPreview(tasks: TaskItem[], userId: string | undefined): TaskItem[] {
  return tasks.filter((task) => !['completed','cancelled'].includes(task.status)).sort((a,b) => {
    const rank = taskRank(a,userId) - taskRank(b,userId); if (rank !== 0) return rank;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  }).slice(0,5);
}
function buildAttention(approvals: ApprovalRequestItem[], tasks: TaskItem[]): Array<{ id:string; href:string; badge:string; tone:'danger'|'warning'|'neutral'; title:string; subtitle:string; date:string }> {
  const rows = [
    ...approvals.map((item) => ({ id:`approval-${item.id}`, href:'/approvals', badge:'Согласование', tone:'warning' as const, title:item.summary.title, subtitle:item.summary.subtitle ?? 'Ожидает решения', date:formatDate(item.createdAt) })),
    ...tasks.filter((task) => task.isOverdue && task.status !== 'completed').map((task) => ({ id:`task-${task.id}`, href:`/tasks/${task.id}`, badge:'Просрочено', tone:'danger' as const, title:task.title, subtitle:task.targetName || 'Без привязки', date:formatTaskTime(task) })),
    ...tasks.filter((task) => task.status === 'awaiting_confirmation' && !task.isOverdue).map((task) => ({ id:`confirm-${task.id}`, href:`/tasks/${task.id}`, badge:'Подтверждение', tone:'neutral' as const, title:task.title, subtitle:task.targetName || 'Без привязки', date:formatTaskTime(task) })),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => { const key = row.id.replace(/^confirm-/,'task-'); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0,5);
}

export function DashboardWorkspaceV2(): React.JSX.Element {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData>({ approvals:[], tasks:EMPTY_TASKS, objects:[], orders:EMPTY_ORDERS, employees:EMPTY_EMPLOYEES, unassignedEmployees:0, overdueCandidates:0, money:EMPTY_MONEY, objectSignals:{} });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => fallback);
    const loadMoney = async (): Promise<MoneyState> => {
      if (!user?.capabilities?.canReviewAccountability) return EMPTY_MONEY;
      const accounts = await safe(listAccountabilityAccounts(), []);
      const submitted = accounts.reduce((sum, account) => sum + account.summary.submittedExpensesCount, 0);
      const closures = accounts.filter((account) => account.status === 'closing_requested').length;
      const details = await Promise.all(accounts.map((account) => safe(getAccountabilityAccountByUserId(account.user.id), null)));
      const receipts = details.flatMap((detail) => detail?.fundings ?? []).filter((funding) => funding.fundingType === 'one_time_order_receipt' && funding.entryDirection === 'credit');
      return { accounts, submitted, closures, receiptCount: receipts.length, receiptAmount: receipts.reduce((sum, item) => sum + Number(item.amount), 0) };
    };
    const loadObjectSignals = async (objects: ServiceObject[]): Promise<ObjectSignals> => {
      const activeObjects = objects.filter((item) => item.status === 'active');
      const attendanceRequired = isAttendanceWindow();
      const reportRequired = isReportDue();
      const entries = await Promise.all(activeObjects.map(async (item) => {
        const [attendance, report] = await Promise.all([
          attendanceRequired ? safe(getTodayObjectAttendance(item.id), null) : Promise.resolve(null),
          reportRequired ? safe(getTodayDailyReport(item.id), null) : Promise.resolve(null),
        ]);
        return [item.id, { attendanceMissing: attendanceRequired && attendance !== null && attendance.employeeIds.length === 0, dailyReportMissing: reportRequired && report === null }] as const;
      }));
      return Object.fromEntries(entries);
    };

    setLoading(true); setFailed(false);
    void Promise.all([
      safe(listApprovalRequests({ status:'pending' }), []),
      safe(listTasks({ page:1, limit:60, sortBy:'dueAt', sortDirection:'asc' }), EMPTY_TASKS),
      safe(listObjects(), []),
      safe(listOneTimeOrders({ page:1, limit:12, sortBy:'executionStartDate', sortDirection:'asc' }), EMPTY_ORDERS),
      safe(listEmployees({ archiveState:'active', page:1, limit:1 }), EMPTY_EMPLOYEES),
      safe(listEmployees({ archiveState:'active', hasActiveObjectAssignment:false, page:1, limit:1 }), EMPTY_EMPLOYEES),
      user?.capabilities?.canAccessCandidates ? safe(listCandidates({ slaState:'overdue', archiveState:'active', page:1, limit:1 }), { items:[], page:1, limit:1, total:0, totalPages:0 }) : Promise.resolve({ items:[], page:1, limit:1, total:0, totalPages:0 }),
      loadMoney(),
    ]).then(async ([approvals,tasks,objects,orders,employees,unassigned,candidates,moneyState]) => {
      const objectSignals = await loadObjectSignals(objects);
      if (!active) return;
      setData({ approvals,tasks,objects,orders,employees,unassignedEmployees:unassigned.total,overdueCandidates:candidates.total,money:moneyState,objectSignals });
      setLoading(false);
    }).catch(() => { if (active) { setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [user?.capabilities?.canAccessCandidates, user?.capabilities?.canReviewAccountability]);

  const activeObjects = useMemo(() => data.objects.filter((item) => item.status === 'active'), [data.objects]);
  const attendanceMissingCount = useMemo(() => activeObjects.filter((item) => data.objectSignals[item.id]?.attendanceMissing).length, [activeObjects,data.objectSignals]);
  const reportMissingCount = useMemo(() => activeObjects.filter((item) => data.objectSignals[item.id]?.dailyReportMissing).length, [activeObjects,data.objectSignals]);
  const problemObjects = useMemo(() => activeObjects.filter((item) => !item.responsible || item.employees.length === 0 || data.objectSignals[item.id]?.attendanceMissing || data.objectSignals[item.id]?.dailyReportMissing), [activeObjects,data.objectSignals]);
  const objectPreview = useMemo(() => [...problemObjects, ...activeObjects.filter((item) => !problemObjects.some((problem) => problem.id === item.id))].slice(0,4), [activeObjects,problemObjects]);
  const tasks = useMemo(() => taskPreview(data.tasks.items,user?.id), [data.tasks.items,user?.id]);
  const attention = useMemo(() => buildAttention(data.approvals,data.tasks.items), [data.approvals,data.tasks.items]);
  const orders = useMemo(() => data.orders.items.filter((item) => !['completed','cancelled'].includes(item.status)).slice(0,3), [data.orders.items]);
  const todayOrders = useMemo(() => data.orders.items.filter((item) => item.executionStartDate && dateKey(new Date(item.executionStartDate)) === moscowParts().date && !['completed','cancelled'].includes(item.status)).length, [data.orders.items]);
  const employeeAssignments = useMemo(() => activeObjects.reduce((sum,item) => sum + item.employees.length,0), [activeObjects]);
  const decisions = data.approvals.length + data.money.submitted + data.money.closures;
  const attentionCount = attention.length + attendanceMissingCount + reportMissingCount;
  const name = user ? firstName(getUserDisplayName(user)) : '';

  return <div className={styles.root}>
    <section className={styles.intro}>
      <div className={styles.introCopy}><div className={styles.greeting}>{greeting()}{name ? `, ${name}` : ''}</div><div className={styles.summary}>{loading ? 'Обновляем рабочую сводку…' : attentionCount > 0 ? `На сегодня ${attentionCount} ${attentionCount === 1 ? 'вопрос требует' : 'вопросов требуют'} внимания` : 'На сегодня срочных вопросов нет'}</div></div>
      <div className={styles.health}><i className={`${styles.dot} ${attentionCount > 0 ? styles.attentionDot : ''}`} />{loading ? 'Обновление' : attentionCount > 0 ? 'Есть приоритеты' : 'Спокойный контур'}</div>
    </section>
    {failed ? <div className={styles.notice}>Часть данных рабочего стола временно недоступна.</div> : null}

    <section className={styles.today} aria-label="Сегодня">
      <div className={styles.todayLabel}>Сегодня</div>
      <Link className={styles.todayItem} href="/objects"><strong>{loading ? '—' : activeObjects.length}</strong><span>объектов</span></Link>
      <Link className={styles.todayItem} href="/employees"><strong>{loading ? '—' : employeeAssignments}</strong><span>назначений сотрудников</span></Link>
      <Link className={`${styles.todayItem} ${attendanceMissingCount > 0 ? styles.todayItemAlert : ''}`} href="/objects"><strong>{loading ? '—' : attendanceMissingCount}</strong><span>без отметки присутствия</span></Link>
      <Link className={styles.todayItem} href="/one-time-orders"><strong>{loading ? '—' : todayOrders}</strong><span>разовых сегодня</span></Link>
      <Link className={`${styles.todayItem} ${decisions > 0 ? styles.todayItemAlert : ''}`} href="/approvals"><strong>{loading ? '—' : decisions}</strong><span>решений от вас</span></Link>
    </section>

    <div className={styles.grid}>
      <div className={styles.column}>
        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Требует внимания</h2><span className={styles.count}>{attention.length + attendanceMissingCount + reportMissingCount}</span></div><Link href="/tasks">Все →</Link></header>
          <div className={styles.rows}>
            {attendanceMissingCount > 0 ? <Link className={styles.row} href="/objects"><span className={`${styles.badge} ${styles.warning}`}>Объекты</span><span className={styles.rowCopy}><strong>Нет отметки присутствия</strong><small>{attendanceMissingCount} объектов в рабочем окне 08:30–17:00</small></span><span className={styles.meta}>Сегодня</span></Link> : null}
            {reportMissingCount > 0 ? <Link className={styles.row} href="/objects"><span className={`${styles.badge} ${styles.warning}`}>Отчёт</span><span className={styles.rowCopy}><strong>Нет дневного отчёта</strong><small>{reportMissingCount} объектов после 17:00</small></span><span className={styles.meta}>Сегодня</span></Link> : null}
            {loading ? <div className={styles.empty}>Загружаем сигналы…</div> : attention.length === 0 && attendanceMissingCount === 0 && reportMissingCount === 0 ? <div className={styles.empty}><strong>Нет срочных вопросов</strong></div> : attention.slice(0,Math.max(0,5-(attendanceMissingCount>0?1:0)-(reportMissingCount>0?1:0))).map((item) => <Link className={styles.row} href={item.href} key={item.id}><span className={`${styles.badge} ${item.tone === 'danger' ? styles.danger : item.tone === 'warning' ? styles.warning : styles.neutral}`}>{item.badge}</span><span className={styles.rowCopy}><strong>{item.title}</strong><small>{item.subtitle}</small></span><span className={styles.meta}>{item.date}</span></Link>)}
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Объекты</h2>{problemObjects.length > 0 ? <span className={styles.count}>{problemObjects.length}</span> : null}</div><Link href="/objects">Все →</Link></header>
          <div className={styles.sectionSummary}><strong>{loading ? '—' : activeObjects.length}</strong><span>активных</span><span>{problemObjects.length > 0 ? `${problemObjects.length} требуют внимания` : 'Проблем не обнаружено'}</span></div>
          <div className={styles.rows}>{objectPreview.map((item) => {
            const issues = [!item.responsible ? 'нет ответственного' : null,item.employees.length===0 ? 'нет сотрудников' : null,data.objectSignals[item.id]?.attendanceMissing ? 'нет отметки' : null,data.objectSignals[item.id]?.dailyReportMissing ? 'нет отчёта' : null].filter(Boolean);
            return <Link className={`${styles.row} ${styles.objectRow}`} href={`/objects/${item.id}`} key={item.id}><span className={styles.rowCopy}><strong>{item.name}</strong><small>{item.address}</small></span><span className={`${styles.meta} ${issues.length ? styles.problem : ''}`}>{issues.length ? issues.join(' · ') : item.responsible?.fullName ?? '—'}</span><span className={styles.meta}>{item.employees.length} чел.</span></Link>;
          })}</div>
        </section>
      </div>

      <div className={styles.column}>
        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Мои задачи</h2><span className={styles.count}>{tasks.length}</span></div><Link href="/tasks">Все →</Link></header>
          <div className={styles.rows}>{tasks.length === 0 && !loading ? <div className={styles.empty}>Ближайших задач нет.</div> : tasks.map((task) => <Link className={`${styles.row} ${styles.taskRow}`} href={`/tasks/${task.id}`} key={task.id}><span className={`${styles.badge} ${task.isOverdue ? styles.danger : task.dueAt && dateKey(new Date(task.dueAt))===moscowParts().date ? styles.warning : styles.neutral}`}>{task.isOverdue ? 'Просрочено' : task.dueAt && dateKey(new Date(task.dueAt))===moscowParts().date ? 'Сегодня' : task.myAssignment ? 'Моя' : 'Компания'}</span><span className={styles.rowCopy}><strong>{task.title}</strong><small>{task.targetName || 'Без привязки'}</small></span><span className={styles.taskTime}>{formatTaskTime(task)}</span></Link>)}</div>
        </section>

        {user?.capabilities?.canAccessAccountability ? <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Деньги</h2>{data.money.submitted + data.money.closures > 0 ? <span className={styles.count}>{data.money.submitted + data.money.closures}</span> : null}</div><Link href="/accountability">Подотчёт →</Link></header>
          <div className={styles.finance}>
            <Link href="/accountability" className={styles.financeItem}><span>Расходы на проверке</span><strong>{loading ? '—' : data.money.submitted}</strong><small>ожидают решения</small></Link>
            <Link href="/accountability" className={styles.financeItem}><span>Закрытие подотчёта</span><strong>{loading ? '—' : data.money.closures}</strong><small>ждут решения</small></Link>
            <Link href="/accountability" className={styles.financeItem}><span>Приход по разовым</span><strong>{loading ? '—' : money(data.money.receiptAmount)}</strong><small>{data.money.receiptCount} поступлений</small></Link>
          </div>
        </section> : null}

        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Разовые заказы</h2></div><Link href="/one-time-orders">Все →</Link></header>
          <div className={styles.rows}>{orders.length === 0 && !loading ? <div className={styles.empty}>Нет ближайших активных заказов.</div> : orders.map((item) => <Link className={`${styles.row} ${styles.orderRow}`} href={`/one-time-orders/${item.id}`} key={item.id}><span className={styles.rowCopy}><strong>{item.title}</strong><small>{item.linkedObject?.name ?? item.executionAddress}</small></span><span className={styles.meta}>{orderStatus(item.status)}</span><span className={styles.meta}>{formatDate(item.executionStartDate)}</span></Link>)}</div>
        </section>

        <section className={styles.panel}>
          <header className={styles.head}><div className={styles.headTitle}><h2>Люди</h2></div><Link href="/employees">Все →</Link></header>
          <div className={styles.people}>
            <Link href="/employees" className={styles.peopleItem}><strong>{loading ? '—' : data.employees.total}</strong><span>активных сотрудников</span></Link>
            <Link href="/employees?hasActiveObjectAssignment=false" className={styles.peopleItem}><strong>{loading ? '—' : data.unassignedEmployees}</strong><span>без объекта</span></Link>
            {user?.capabilities?.canAccessCandidates ? <Link href="/candidates?slaState=overdue" className={styles.peopleItem}><strong>{loading ? '—' : data.overdueCandidates}</strong><span>кандидатов с просроченным SLA</span></Link> : <div className={styles.peopleItem}><strong>—</strong><span>кандидаты недоступны</span></div>}
          </div>
        </section>
      </div>
    </div>
  </div>;
}
